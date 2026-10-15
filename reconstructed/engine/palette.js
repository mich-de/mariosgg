// DIB resource decoder: a standard Windows BMP (8bpp, 256-color) used purely as a
// palette carrier. Observed pixel data is a single throwaway pixel (w=1,h=1); the
// payload's real content is the 256-entry BGRX color table at offset biSize+14.
// Verified against all 4 DIB records in mario.prs ("Intrply_clut", "Presage_clut",
// "NewPalette", "BlackPal"): magic "BM", biBitCount 8, biClrUsed matching a full 256 table.

export function decodePalette(payload) {
  const dv = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  if (payload[0] !== 0x42 || payload[1] !== 0x4d) throw new Error("not a BMP: bad magic");
  const dataOffset = dv.getUint32(10, true);
  const biSize = dv.getUint32(14, true);
  const bitCount = dv.getUint16(28, true);
  if (bitCount !== 8) throw new Error(`unexpected DIB bit depth ${bitCount}`);
  const palStart = 14 + biSize;
  const rgba = new Uint8Array(256 * 4);
  for (let i = 0; i < 256; i++) {
    const b = payload[palStart + i * 4 + 0];
    const g = payload[palStart + i * 4 + 1];
    const r = payload[palStart + i * 4 + 2];
    rgba[i * 4 + 0] = r;
    rgba[i * 4 + 1] = g;
    rgba[i * 4 + 2] = b;
    rgba[i * 4 + 3] = 255;
  }
  void dataOffset; // pixel data itself (the 1x1 throwaway) is not used.
  return rgba;
}
