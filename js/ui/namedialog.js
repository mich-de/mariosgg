// "What is your name?" (dialog 1000, overlay 678a): box Pak 100 at (62,76), OK (87,128),
// CANCEL (187,128). Text field at (113,112), 100 px wide, font 224, max 10 characters, glyphs
// spaced by width+1. The first keystroke replaces the old name. Keys 9201, error 9202,
// backspace 9203, buttons 9204. On touch devices the system keyboard is raised via a hidden
// <input> (tap the field to bring it back).

import { PakDialog } from "./toolkit.js";

const FX = 113, FY = 112, FW = 100, FONT = 224, MAX = 10;

export class NameDialog extends PakDialog {
  constructor(e, name) {
    super(e, 100, 62, 76, [
      { frame: 1, pressed: 3, x: 87 - 62, y: 128 - 76, value: "ok", key: ["enter"] },
      { frame: 2, pressed: 4, x: 187 - 62, y: 128 - 76, value: "cancel", key: ["escape"] },
    ]);
    this.text = name || "My Friend";
    this.fresh = true;
    this.blink = 0;
    this.kb = document.getElementById("kb");
  }
  show() {
    const p = super.show();
    this.attachKb();
    return p.then((v) => (v === "ok" ? this.text : null));
  }
  attachKb() {
    const kb = this.kb;
    if (!kb) return;
    this.onKbKey = (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      this.key(ev.key);
    };
    this.onKbInput = (ev) => {
      // Android virtual keyboards often report key "Unidentified": read the input value instead.
      const v = kb.value;
      kb.value = "";
      for (const ch of v) this.key(ch);
    };
    kb.addEventListener("keydown", this.onKbKey);
    kb.addEventListener("input", this.onKbInput);
    if (this.e.pointer.type !== "mouse") this.focusKb();
  }
  focusKb() {
    try {
      this.kb.value = "";
      this.kb.focus({ preventScroll: true });
    } catch (e) {}
  }
  close(v) {
    const kb = this.kb;
    if (kb) {
      kb.removeEventListener("keydown", this.onKbKey);
      kb.removeEventListener("input", this.onKbInput);
      kb.blur();
    }
    super.close(v);
  }
  tick() {
    this.blink++;
  }
  textWidth(s) {
    let w = 0;
    for (const c of s) w += this.glyphW(c) + 1;
    return w;
  }
  glyphW(c) {
    const g = this.e.gfx;
    return g.frameInfo(FONT, g.glyph(c.charCodeAt(0))).w;
  }
  renderExtra(s) {
    const g = this.e.gfx;
    let x = FX;
    for (const c of this.text) {
      g.frame(FONT, g.glyph(c.charCodeAt(0)), x, FY);
      x += this.glyphW(c) + 1;
    }
    if (!this.fresh && (this.blink >> 2) % 2 === 0) s.fillRect(x, FY, x + 1, FY + 8, 255);
  }
  pointerDown(x, y) {
    if (x >= FX - 6 && x < FX + FW + 6 && y >= FY - 6 && y < FY + 14) {
      this.focusKb();
      return;
    }
    super.pointerDown(x, y);
  }
  key(k) {
    const au = this.e.audio;
    if (k === "Enter") return this.close("ok");
    if (k === "Escape") return this.close("cancel");
    if (k === "Backspace" || k === "Delete") {
      if (this.fresh) {
        this.text = "";
        this.fresh = false;
        au.playSnd(9203);
      } else if (!this.text.length) au.playSnd(9202);
      else {
        this.text = this.text.slice(0, -1);
        au.playSnd(9203);
      }
      return;
    }
    if (k.length !== 1) return;
    const code = k.charCodeAt(0);
    if (code < 0x20 || code > 0x7d) return;
    if (this.fresh) {
      this.text = "";
      this.fresh = false;
    }
    if (this.text.length >= MAX || this.textWidth(this.text + k) > FW - 12) return void au.playSnd(9202);
    this.text += k;
    au.playSnd(9201);
  }
}
