// Resource layer: the original game's single data file, mario.prs, parsed client-side.
//
// Every format here was recovered from mario.exe (see docs/FORMATS.md):
//   PRS container   "PRS Format Resource File" + records [tag4][id u16][name 18][len u32][payload]
//   Pak             sprite/frame container, custom scanline RLE (blitter 1d4e:0004)
//   DIB             Windows BMP used only as a 256-colour palette carrier
//   SND             u16 3, u16 len, u16 rate, 8-bit unsigned mono PCM
//   MuV/Ply/Img     animation ("movie") header, timeline and per-frame offsets

const TEXT = new TextDecoder("latin1");

export class PRS {
  constructor(buffer) {
    const u8 = new Uint8Array(buffer);
    if (TEXT.decode(u8.subarray(0, 24)) !== "PRS Format Resource File") throw new Error("mario.prs: bad magic");
    const dv = new DataView(buffer);
    this.byTag = new Map();
    let pos = 0x30;
    while (pos + 0x1c <= u8.length) {
      const tag = TEXT.decode(u8.subarray(pos, pos + 3));
      const id = dv.getUint16(pos + 4, true);
      const nameBytes = u8.subarray(pos + 6, pos + 0x18);
      const z = nameBytes.indexOf(0);
      const name = TEXT.decode(z < 0 ? nameBytes : nameBytes.subarray(0, z));
      const len = dv.getUint32(pos + 0x18, true);
      if (len < 0x1c || pos + len > u8.length) throw new Error("mario.prs: corrupt record at " + pos);
      let bucket = this.byTag.get(tag);
      if (!bucket) this.byTag.set(tag, (bucket = new Map()));
      bucket.set(id, { tag, id, name, payload: u8.subarray(pos + 0x1c, pos + len) });
      pos += len;
    }
    this.cache = new Map();
  }
  get(tag, id) {
    const b = this.byTag.get(tag);
    return (b && b.get(id)) || null;
  }
  has(tag, id) {
    return !!this.get(tag, id);
  }
  memo(key, fn) {
    let v = this.cache.get(key);
    if (v === undefined) {
      v = fn();
      this.cache.set(key, v);
    }
    return v;
  }
  pak(id) {
    return this.memo("Pak" + id, () => {
      const r = this.get("Pak", id);
      if (!r) throw new Error("missing Pak " + id);
      return decodePak(r.payload);
    });
  }
  palette(id) {
    return this.memo("DIB" + id, () => decodePalette(this.get("DIB", id).payload));
  }
  movie(id) {
    return this.memo("MuV" + id, () => decodeMovie(this, id));
  }
}

// ---------------------------------------------------------------- Pak

// One frame of a Pak. px = palette indices, a = opacity mask (1 = drawn). x/y are the
// draw offsets carried only by the ver&0x8000 variant (PakFrameRect, 35a7:021a).
function decodeRLE(p, src, w, h) {
  const n = w * h;
  const px = new Uint8Array(n);
  const a = new Uint8Array(n);
  let row = 0;
  let cur = 0;
  const stack = [];
  for (;;) {
    const c = p[src++];
    if (c & 0x80) {
      row += w;
      cur = row;
    }
    let cnt = c & 0x1f;
    if (cnt === 0) {
      cnt = (p[src] << 8) | p[src + 1];
      src += 2;
    }
    if (c & 0x40) {
      if (c & 0x20) {
        for (let i = 0; i < cnt; i++, cur++) {
          if (cur >= 0 && cur < n) {
            px[cur] = p[src];
            a[cur] = 1;
          }
          src++;
        }
      } else {
        if (cnt === 1) break; // REPEAT x1 terminates the frame
        const v = p[src++];
        for (let i = 0; i < cnt; i++, cur++) {
          if (cur >= 0 && cur < n) {
            px[cur] = v;
            a[cur] = 1;
          }
        }
      }
    } else if (c & 0x20) {
      cur += cnt; // transparent run
    } else if (cnt > 1) {
      stack.push([src, cnt - 1]); // open a repeat block (max depth 12 in the original)
    } else {
      if (!stack.length) break;
      const top = stack[stack.length - 1];
      if (top[1] > 0) {
        top[1]--;
        src = top[0];
      } else stack.pop();
    }
  }
  return { px, a };
}

export function decodePak(p) {
  const dv = new DataView(p.buffer, p.byteOffset, p.byteLength);
  const ver = dv.getUint16(0, true);
  const count = dv.getUint16(2, true);
  const frames = [];
  for (let i = 0; i < count; i++) {
    const o = dv.getUint32(6 + i * 4, true);
    let x = 0, y = 0, w, h, ds;
    if (ver & 0x8000) {
      x = dv.getInt16(o, false);
      y = dv.getInt16(o + 2, false);
      w = dv.getUint16(o + 4, false);
      h = dv.getUint16(o + 6, false);
      ds = o + 8;
    } else {
      w = dv.getUint16(o, false);
      h = dv.getUint16(o + 2, false);
      ds = o + 4;
    }
    if (!w || !h) {
      frames.push({ x, y, w: 0, h: 0, px: new Uint8Array(0), a: new Uint8Array(0) });
      continue;
    }
    const { px, a } = decodeRLE(p, ds, w, h);
    frames.push({ x, y, w, h, px, a });
  }
  return { ver, frames, tiled: !(ver & 0x8000) && count === 64 && frames.every((f) => f.w === 40 && f.h === 25) };
}

// ---------------------------------------------------------------- palette

export function decodePalette(p) {
  const dv = new DataView(p.buffer, p.byteOffset, p.byteLength);
  const start = 14 + dv.getUint32(14, true);
  const pal = new Uint8Array(768);
  for (let i = 0; i < 256; i++) {
    // The game writes the DIB's 8-bit colours to the VGA DAC (6 bits); expand them back the
    // same way real hardware/emulators show them, so colours match the original exactly.
    for (let c = 0; c < 3; c++) {
      const v6 = p[start + i * 4 + (2 - c)] >> 2;
      pal[i * 3 + c] = (v6 << 2) | (v6 >> 4);
    }
  }
  return pal;
}

// ---------------------------------------------------------------- SND

export function decodeSnd(p) {
  const dv = new DataView(p.buffer, p.byteOffset, p.byteLength);
  const len = dv.getUint16(2, true);
  const rate = dv.getUint16(4, true);
  return { rate, pcm: p.subarray(6, 6 + Math.min(len, p.length - 6)) };
}

// ---------------------------------------------------------------- movies (MuV + Ply + Img + Pak)

// LoadMovie (2d21:01e6): the talking-head phrase movies (ids >= 10000) only carry MuV+Ply;
// their frames and offsets come from the shared base resource id/1000*1000.
export function decodeMovie(prs, id) {
  const m = prs.get("MuV", id);
  if (!m) throw new Error("missing MuV " + id);
  const mv = new DataView(m.payload.buffer, m.payload.byteOffset, m.payload.byteLength);
  const base = id >= 10000 ? Math.floor(id / 1000) * 1000 : id;
  const ply = prs.get("Ply", id);
  const img = prs.get("Img", base);
  const recs = [];
  if (ply) {
    const pd = new DataView(ply.payload.buffer, ply.payload.byteOffset, ply.payload.byteLength);
    for (let o = 0; o + 16 <= ply.payload.length; o += 16) {
      const type = pd.getUint16(o, true);
      const r = {
        type,
        arg: pd.getUint16(o + 2, true),
        start: pd.getUint32(o + 4, true),
        dur: pd.getUint32(o + 8, true),
        v: pd.getInt16(o + 12, true),
        h: pd.getInt16(o + 14, true),
      };
      recs.push(r);
      if (type === 10) break;
    }
  }
  const offs = [];
  if (img) {
    const id2 = new DataView(img.payload.buffer, img.payload.byteOffset, img.payload.byteLength);
    // Img record: h, v, then the frame rect (left, top, right, bottom); the draw position is
    // rect.left/top offset by (h + movie x, v + movie y)  (DrawMovieAt 2d21:077f).
    for (let o = 0; o + 12 <= img.payload.length; o += 12)
      offs.push({ h: id2.getInt16(o, true) + id2.getInt16(o + 4, true), v: id2.getInt16(o + 2, true) + id2.getInt16(o + 6, true) });
  }
  return {
    id,
    pakId: base,
    h: mv.getInt16(2, true),
    v: mv.getInt16(4, true),
    duration: mv.getUint32(0x0e, true),
    step: mv.getUint16(0x14, true) || 60,
    recs,
    offs,
  };
}
