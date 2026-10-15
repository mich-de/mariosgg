// Pak resource decoder — sprite/background frame container with a custom scanline RLE codec.
//
// Every detail below is read directly off the real decode routine, not inferred from samples.
// Container layout confirmed by decompiling FUN_35a7_0b90 (mario_unified.exe, Ghidra 12.1.4):
//   +0x00 u16 version (unused by the loader)
//   +0x02 u16 frameCount
//   +0x04 u16 unused
//   +0x06 frameCount x u32   byte offset of each frame within the payload that follows this table
//   last frame's length = payload.length - lastOffset (there is no explicit terminating offset;
//   the loader gets the Pak resource's total byte length from the PRS directory and uses that as
//   the implicit end, exactly mirroring what tools/prs_extract.py already does independently).
//
// Each frame (at its offset) starts with a 5-byte header, then the RLE pixel stream:
//   +0x00 u16 width   (big-endian)
//   +0x02 u16 height  (big-endian)
//   +0x04 u8  bgIndex (consumer not identified in the decompiled code reached so far; not needed
//                      for correct decoding — transparency is fully carried by the RLE stream itself)
//
// RLE codec traced instruction-by-instruction from FUN_1d4e_0004 (the unclipped, top-down blit
// variant — raw assembly, not decompiled C, since the decompiler lost track of a couple of
// registers across the loop). One destination cursor walks the output buffer; a separate
// "row base" advances by +-stride whenever a control byte carries the row-advance bit, and the
// cursor resets to that row base before the byte is otherwise interpreted. Each control byte:
//
//   bit 7 (0x80): row-advance — move row base by one scanline stride (sign = draw direction),
//                 then reset the write cursor to the new row base, before acting on this byte.
//   count field = byte & 0x1F.
//     count == 0: the real count is the next two stream bytes, big-endian (first byte = high).
//     count != 0: that 5-bit value is the count directly.
//   bit 6 (0x40) set  -> write `count` pixels:
//       bit 5 (0x20) set   -> COPY: copy `count` literal bytes from the compressed stream.
//       bit 5 (0x20) clear -> REPEAT: read one byte, write it `count` times.
//            special case: REPEAT with count == 1 unconditionally ends the frame (discarding
//            any still-open repeat blocks below).
//   bit 6 (0x40) clear:
//       bit 5 (0x20) set   -> SKIP: advance the cursor by `count` pixels, writing nothing
//                             (these pixels stay transparent).
//       bit 5 (0x20) clear -> block-repeat control, using a small nesting stack (depth <= 12,
//                             matching the real code's bound):
//            count > 1  -> open a block: remember the stream position right after this byte and
//                           the repeat count, then continue decoding (the block body follows).
//            count <= 1 -> close the innermost open block: if repeats remain, rewind the stream
//                           to the saved position and decrement; otherwise drop the block and
//                           continue after it. With no block open, this ends the frame.
//
// This nested-repeat construct is why a frame's raw byte stream does not contain one row-advance
// marker per scanline: a repeated background band can be encoded once and replayed, which is
// exactly the pattern observed by eye in every sample frame before this routine was found.

function decodeFrameHeader(view, offset) {
  const width = view.getUint16(offset, false);
  const height = view.getUint16(offset + 2, false);
  const bgIndex = view.getUint8(offset + 4);
  return { width, height, bgIndex, dataOffset: offset + 5 };
}

// Decode one frame to an indexed (palette-index) buffer, width*height bytes, 0xFF = transparent.
export function decodePakFrame(payload, frameOffset) {
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const { width, height, bgIndex, dataOffset } = decodeFrameHeader(view, frameOffset);
  const stride = width;
  const out = new Uint8Array(width * height).fill(0xff);

  let src = dataOffset;
  let rowBase = 0;
  let cursor = 0;
  const stack = []; // {resumeSrc, remaining}

  const readU8 = () => payload[src++];

  while (true) {
    const ctrl = readU8();
    if (ctrl & 0x80) {
      rowBase += stride;
      cursor = rowBase;
    }
    let count = ctrl & 0x1f;
    if (count === 0) {
      const hi = readU8();
      const lo = readU8();
      count = (hi << 8) | lo;
    }
    if (ctrl & 0x40) {
      if (ctrl & 0x20) {
        // COPY: literal bytes from the stream.
        for (let i = 0; i < count; i++) out[cursor++] = readU8();
      } else {
        // REPEAT: one byte value, written `count` times.
        if (count === 1) {
          // Hard stop: unconditionally ends the frame.
          break;
        }
        const v = readU8();
        for (let i = 0; i < count; i++) out[cursor++] = v;
      }
    } else if (ctrl & 0x20) {
      // SKIP: transparent run, cursor advances, nothing written.
      cursor += count;
    } else if (count > 1) {
      // Open a repeat block.
      stack.push({ resumeSrc: src, remaining: count - 1 });
    } else {
      // Close the innermost block, or end the frame if none is open.
      if (stack.length === 0) break;
      const top = stack[stack.length - 1];
      if (top.remaining > 0) {
        top.remaining -= 1;
        src = top.resumeSrc;
      } else {
        stack.pop();
      }
    }
  }

  return { width, height, bgIndex, indices: out };
}

// Decode every frame of a Pak resource payload (as produced by prs.js) using its own offset table.
//
// Only the `ver` bit-15-clear variant is understood (confirmed against 142/187 of the Pak
// resources in mario.prs). The other 45 all have `ver` with bit 15 set (e.g. 0x8002) and use a
// different, not-yet-traced layout — this throws rather than silently decoding garbage for them.
export function decodePak(payload) {
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const ver = view.getUint16(0, true);
  if (ver & 0x8000) throw new Error(`unsupported Pak variant ver=0x${ver.toString(16)} (bit 15 set)`);
  const frameCount = view.getUint16(2, true);
  const offsets = [];
  for (let i = 0; i < frameCount; i++) offsets.push(view.getUint32(6 + i * 4, true));
  const frames = offsets.map((off) => decodePakFrame(payload, off));
  return frames;
}

// Render a decoded frame to an RGBA Uint8ClampedArray using a 256-entry palette (see palette.js).
export function pakFrameToRgba(frame, palette) {
  const { width, height, indices } = frame;
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < indices.length; i++) {
    const idx = indices[i];
    if (idx === 0xff) continue; // transparent: leave at 0,0,0,0
    rgba[i * 4 + 0] = palette[idx * 4 + 0];
    rgba[i * 4 + 1] = palette[idx * 4 + 1];
    rgba[i * 4 + 2] = palette[idx * 4 + 2];
    rgba[i * 4 + 3] = 255;
  }
  return rgba;
}
