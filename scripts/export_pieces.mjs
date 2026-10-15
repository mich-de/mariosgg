// Export clean Checkers piece art decoded straight from mario.prs via the reconstructed
// engine's Pak codec, replacing the earlier screenshot-cropped placeholders.
//
// Koopa source (Pak id 2800, frame 0, 79x27) shows a celebrating PAIR of koopas; the two
// figures are separated by a genuinely fully-transparent gap at columns 37-39 (verified by
// scanning the decoded alpha channel), so the left figure (columns 0-36) is cropped out as a
// single on-board piece icon — a crop of real decoded pixels, not a guess or a fabrication.
// Yoshi source (Pak id 2801, frame 0, 21x19) is already a single standing figure, used as-is.
import { decodePak, pakFrameToRgba } from "../reconstructed/engine/pak.js";
import { decodePalette } from "../reconstructed/engine/palette.js";
import fs from "fs";
import { execFileSync } from "child_process";

const root = "analysis/prs_raw/";
const palPayload = fs.readFileSync(root + "DIB/01000_NewPalette.bin");
const palette = decodePalette(new Uint8Array(palPayload.buffer, palPayload.byteOffset, palPayload.byteLength));

function loadFrame(file, frameIndex) {
  const buf = fs.readFileSync(root + file);
  const payload = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  const frames = decodePak(payload);
  return frames[frameIndex];
}

function writePng(rgba, w, h, outPath) {
  const header = `P6\n${w} ${h}\n255\n`;
  const rgb = Buffer.alloc(w * h * 3);
  const alpha = Buffer.alloc(w * h);
  for (let p = 0; p < w * h; p++) {
    rgb[p * 3] = rgba[p * 4]; rgb[p * 3 + 1] = rgba[p * 4 + 1]; rgb[p * 3 + 2] = rgba[p * 4 + 2];
    alpha[p] = rgba[p * 4 + 3];
  }
  const tmpRgb = outPath + ".rgb.ppm";
  const tmpA = outPath + ".a.pgm";
  fs.writeFileSync(tmpRgb, Buffer.concat([Buffer.from(header), rgb]));
  fs.writeFileSync(tmpA, Buffer.concat([Buffer.from(`P5\n${w} ${h}\n255\n`), alpha]));
  execFileSync("magick", [tmpRgb, tmpA, "-alpha", "off", "-compose", "CopyOpacity", "-composite", outPath]);
  fs.unlinkSync(tmpRgb);
  fs.unlinkSync(tmpA);
}

function cropRgba(rgba, w, h, x0, x1) {
  const cw = x1 - x0;
  const out = new Uint8ClampedArray(cw * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = x0; x < x1; x++) {
      const src = (y * w + x) * 4;
      const dst = (y * cw + (x - x0)) * 4;
      out.set(rgba.subarray(src, src + 4), dst);
    }
  }
  return { rgba: out, w: cw, h };
}

// Trim to the tight bounding box of non-transparent pixels — removes empty padding rows/columns
// without touching any pixel that actually has content.
function trimToContent(rgba, w, h) {
  let minX = w, maxX = -1, minY = h, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (rgba[(y * w + x) * 4 + 3] > 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  return cropXY(rgba, w, minX, maxX + 1, minY, maxY + 1);
}

function cropXY(rgba, w, x0, x1, y0, y1) {
  const cw = x1 - x0, ch = y1 - y0;
  const out = new Uint8ClampedArray(cw * ch * 4);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const src = (y * w + x) * 4;
      const dst = ((y - y0) * cw + (x - x0)) * 4;
      out.set(rgba.subarray(src, src + 4), dst);
    }
  }
  return { rgba: out, w: cw, h: ch };
}

const koopaFrame = loadFrame("Pak/02800_checkin-koopaGM.bin", 0);
const koopaRgbaFull = pakFrameToRgba(koopaFrame, palette);
const koopaHalf = cropRgba(koopaRgbaFull, koopaFrame.width, koopaFrame.height, 0, 37);
const koopaTrim = trimToContent(koopaHalf.rgba, koopaHalf.w, koopaHalf.h);
writePng(koopaTrim.rgba, koopaTrim.w, koopaTrim.h, "assets/pieces/koopa.png");
console.log("wrote assets/pieces/koopa.png", koopaTrim.w, "x", koopaTrim.h);

const yoshiFrame = loadFrame("Pak/02801_checkin-yoshiGM.bin", 0);
const yoshiRgbaFull = pakFrameToRgba(yoshiFrame, palette);
const yoshiTrim = trimToContent(yoshiRgbaFull, yoshiFrame.width, yoshiFrame.height);
writePng(yoshiTrim.rgba, yoshiTrim.w, yoshiTrim.h, "assets/pieces/yoshi.png");
console.log("wrote assets/pieces/yoshi.png", yoshiTrim.w, "x", yoshiTrim.h);
