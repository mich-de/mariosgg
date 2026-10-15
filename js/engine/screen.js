// 320x200 indexed-colour framebuffer (VGA mode 13h, like the original) presented on a canvas.
// The art targets a 4:3 monitor (non-square pixels), so the image is scaled 5x horizontally
// and 6x vertically into the backing store, then CSS fits that to the viewport.

import { FONT8 } from "./font8x8.js";

export const W = 320;
export const H = 200;
const SX = 5;
const SY = 6;

export class Screen {
  constructor(canvas) {
    this.canvas = canvas;
    canvas.width = W * SX;
    canvas.height = H * SY;
    this.ctx = canvas.getContext("2d", { alpha: false });
    this.ctx.imageSmoothingEnabled = false;
    this.off = document.createElement("canvas");
    this.off.width = W;
    this.off.height = H;
    this.offCtx = this.off.getContext("2d");
    this.img = this.offCtx.createImageData(W, H);
    this.rgba = new Uint32Array(this.img.data.buffer);
    this.buf = new Uint8Array(W * H);
    this.pal = new Uint8Array(768);
    this.pal32 = new Uint32Array(256);
    this.fade = 1; // 0..1 brightness, used for the original's palette fades
    this.clip = null;
  }

  setPalette(pal) {
    this.pal.set(pal);
    this.updatePal32();
  }
  setFade(f) {
    this.fade = Math.max(0, Math.min(1, f));
    this.updatePal32();
  }
  updatePal32() {
    const p = this.pal;
    const f = this.fade;
    for (let i = 0; i < 256; i++) {
      const r = (p[i * 3] * f) | 0, g = (p[i * 3 + 1] * f) | 0, b = (p[i * 3 + 2] * f) | 0;
      this.pal32[i] = 0xff000000 | (b << 16) | (g << 8) | r;
    }
  }

  setClip(r) {
    this.clip = r ? { l: Math.max(0, r.l), t: Math.max(0, r.t), r: Math.min(W, r.r), b: Math.min(H, r.b) } : null;
  }

  clear(c = 0) {
    this.buf.fill(c);
  }

  fillRect(l, t, r, b, c) {
    const cl = this.clip || { l: 0, t: 0, r: W, b: H };
    l = Math.max(l, cl.l); t = Math.max(t, cl.t); r = Math.min(r, cl.r); b = Math.min(b, cl.b);
    for (let y = t; y < b; y++) this.buf.fill(c, y * W + l, y * W + Math.max(l, r));
  }

  // Draw a decoded Pak frame with its top-left at (x, y) (+ the frame's own offset).
  blit(f, x, y, opts) {
    if (!f || !f.w) return;
    x += f.x;
    y += f.y;
    const cl = this.clip || { l: 0, t: 0, r: W, b: H };
    const flip = opts && opts.flip;
    const remap = opts && opts.remap;
    const x0 = Math.max(x, cl.l), x1 = Math.min(x + f.w, cl.r);
    const y0 = Math.max(y, cl.t), y1 = Math.min(y + f.h, cl.b);
    if (x0 >= x1 || y0 >= y1) return;
    const { px, a, w } = f;
    const buf = this.buf;
    for (let yy = y0; yy < y1; yy++) {
      const srow = (yy - y) * w;
      let d = yy * W + x0;
      for (let xx = x0; xx < x1; xx++, d++) {
        const sx = flip ? w - 1 - (xx - x) : xx - x;
        const s = srow + sx;
        if (a[s]) buf[d] = remap ? remap[px[s]] : px[s];
      }
    }
  }

  // Character from the BIOS 8x8 font, used by the toolkit's menu bar and text fields.
  char8(ch, x, y, fg, bg) {
    const g = (ch & 0xff) * 8;
    const cl = this.clip || { l: 0, t: 0, r: W, b: H };
    for (let r = 0; r < 8; r++) {
      const yy = y + r;
      if (yy < cl.t || yy >= cl.b) continue;
      const bits = FONT8[g + r];
      for (let c = 0; c < 8; c++) {
        const xx = x + c;
        if (xx < cl.l || xx >= cl.r) continue;
        if (bits & (0x80 >> c)) this.buf[yy * W + xx] = fg;
        else if (bg >= 0) this.buf[yy * W + xx] = bg;
      }
    }
  }
  text8(s, x, y, fg, bg = -1) {
    for (let i = 0; i < s.length; i++) this.char8(s.charCodeAt(i), x + i * 8, y, fg, bg);
  }

  present() {
    const n = W * H;
    const b = this.buf, o = this.rgba, p = this.pal32;
    for (let i = 0; i < n; i++) o[i] = p[b[i]];
    this.offCtx.putImageData(this.img, 0, 0);
    this.ctx.drawImage(this.off, 0, 0, W, H, 0, 0, W * SX, H * SY);
  }

  // Map a client (CSS px) position on the canvas to framebuffer coordinates.
  toScreen(clientX, clientY) {
    const r = this.canvas.getBoundingClientRect();
    return {
      x: Math.floor(((clientX - r.left) / r.width) * W),
      y: Math.floor(((clientY - r.top) / r.height) * H),
    };
  }

  snapshot() {
    return this.buf.slice();
  }
  restore(s) {
    this.buf.set(s);
  }
}
