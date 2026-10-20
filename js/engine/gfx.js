// Drawing helpers on top of Screen + PRS: Pak frames, tiled backgrounds, Pak fonts, sprites.

export class Gfx {
  constructor(screen, prs) {
    this.s = screen;
    this.prs = prs;
  }
  frame(pakId, i, x, y, opts) {
    const p = this.prs.pak(pakId);
    this.s.blit(p.frames[i], x, y, opts);
  }
  frameInfo(pakId, i) {
    return this.prs.pak(pakId).frames[i];
  }
  // Full-screen background: 64 tiles of 40x25 (DrawBackground 3a37:0007), or a 0x8002 Pak
  // whose frames carry their own offsets (help pages, dialogs...).
  bg(pakId, ox = 0, oy = 0) {
    const p = this.prs.pak(pakId);
    p.frames.forEach((f, i) => {
      if (p.tiled) this.s.blit(f, ox + (i % 8) * 40, oy + ((i / 8) | 0) * 25);
      else this.s.blit(f, ox, oy);
    });
  }

  // Pak fonts (223 yellow, 224 dark, 225 white): glyph = char - 0x20, space advances by the
  // width of glyph 0x49 ('i'); out-of-range characters draw glyph 0x1f ('?')  (1408:000c).
  glyph(ch) {
    let g = ch - 0x20;
    if (g < 0 || g > 0x5d) g = 0x1f;
    return g;
  }
  textWidth(fontId, str) {
    const p = this.prs.pak(fontId);
    let w = 0;
    for (const c of str) {
      const code = c.charCodeAt(0);
      w += code === 32 ? p.frames[0x49].w : p.frames[this.glyph(code)].w;
    }
    return w;
  }
  text(fontId, str, x, y, align = "left") {
    const p = this.prs.pak(fontId);
    if (align === "center") x -= (this.textWidth(fontId, str) / 2) | 0;
    else if (align === "right") x -= this.textWidth(fontId, str);
    for (const c of str) {
      const code = c.charCodeAt(0);
      if (code === 32) {
        x += p.frames[0x49].w;
        continue;
      }
      const f = p.frames[this.glyph(code)];
      this.s.blit(f, x, y);
      x += f.w;
    }
    return x;
  }
}

// Sprite manager (module 1919): a list where the most recently created / raised sprite is
// drawn last (on top). Hidden sprites stay in the list.
export class Sprites {
  constructor(gfx) {
    this.gfx = gfx;
    this.list = []; // bottom .. top
  }
  find(id) {
    return this.list.find((s) => s.id === id);
  }
  create(x, y, pakId, frame, id = -1, hidden = false) {
    if (id !== -1) this.delete(id);
    const s = { x, y, pakId, frame, id, hidden, opts: null };
    this.list.push(s);
    return s;
  }
  delete(id) {
    const i = this.list.findIndex((s) => s.id === id);
    if (i >= 0) this.list.splice(i, 1);
  }
  clear() {
    this.list.length = 0;
  }
  hide(id) {
    const s = this.find(id);
    if (s) s.hidden = true;
  }
  show(id) {
    const s = this.find(id);
    if (s) s.hidden = false;
  }
  set(id, props) {
    const s = this.find(id);
    if (s) Object.assign(s, props);
  }
  toFront(id) {
    const i = this.list.findIndex((s) => s.id === id);
    if (i >= 0) this.list.push(this.list.splice(i, 1)[0]);
  }
  toBack(id) {
    const i = this.list.findIndex((s) => s.id === id);
    if (i >= 0) this.list.unshift(this.list.splice(i, 1)[0]);
  }
  draw() {
    for (const s of this.list) if (!s.hidden) this.gfx.frame(s.pakId, s.frame, s.x, s.y, s.opts);
  }
  // Topmost visible sprite containing (x,y), optionally filtered.
  hit(x, y, filter) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const s = this.list[i];
      if (s.hidden || (filter && !filter(s))) continue;
      const f = this.gfx.frameInfo(s.pakId, s.frame);
      const l = s.x + f.x, t = s.y + f.y;
      if (x >= l && x < l + f.w && y >= t && y < t + f.h) return s;
    }
    return null;
  }
}
