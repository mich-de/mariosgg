// Mario's talking head (module 1aec). Each phrase table entry is {text, movieId}: the movie is a
// lip-sync timeline over the shared head frames (base 10000 / 11000 / 12000) that also fires
// the voice sample. When idle the head shows the base movie at t = step*10 (mouth closed).

import { Movie } from "./movie.js";

export class Talker {
  constructor(e, opts) {
    this.e = e;
    this.base = opts.base; // 10000, 11000 or 12000
    this.x = opts.x;
    this.y = opts.y;
    this.font = opts.font || 0; // Pak font for the caption (0 = none)
    this.rect = opts.rect || null; // caption rect {l,t,r,b}
    this.table = opts.table || []; // [[text, movieId], ...]
    this.textX = opts.textX; // optional explicit caption x (centre)
    this.textY = opts.textY;
    this.text = "";
    this.talking = false;
    this.hidden = false;
    this.onDone = [];
    this.idle();
  }
  idle() {
    this.mv = new Movie(this.e, this.base);
    this.mv.x = this.x;
    this.mv.y = this.y;
    this.mv.t = this.mv.step * 10;
    this.mv.paused = true;
  }
  // Say phrase `i` of the table (Say 1aec:01a0).
  say(i) {
    const p = this.table[i];
    if (!p) return Promise.resolve();
    return this.sayText(p[1], p[0]);
  }
  sayText(movieId, text) {
    this.text = text || "";
    if (!movieId || !this.e.prs.has("MuV", movieId)) {
      this.talking = false;
      return Promise.resolve();
    }
    if (!this.e.audio.soundOn) {
      // No sound: the original just shows the caption with the head at rest.
      this.talking = false;
      this.idle();
      return this.e.sleep(Math.min(3000, 600 + this.text.length * 45)).catch(() => {});
    }
    this.mv = new Movie(this.e, movieId);
    this.mv.x = this.x;
    this.mv.y = this.y;
    this.talking = true;
    return new Promise((res) => this.onDone.push(res));
  }
  // Called every animation tick by the owning scene (draw/sounds/advance order of the original).
  tick() {
    if (!this.talking) return;
    this.mv.sounds();
    this.mv.advanceOnce();
    if (this.mv.done) {
      this.talking = false;
      this.idle();
      const cbs = this.onDone;
      this.onDone = [];
      cbs.forEach((f) => f());
    }
  }
  stop() {
    if (this.talking) {
      this.talking = false;
      this.e.audio.stopSnd();
      this.idle();
      const cbs = this.onDone;
      this.onDone = [];
      cbs.forEach((f) => f());
    }
  }
  draw() {
    if (!this.hidden) this.mv.draw();
  }
  drawText() {
    if (!this.font || !this.rect || !this.text) return;
    const x = this.textX !== undefined ? this.textX : ((this.rect.l + this.rect.r) / 2) | 0;
    const y = this.textY !== undefined ? this.textY : this.rect.t;
    this.e.gfx.text(this.font, this.text, x, y, "center");
  }
}

// Phrase tables live in the data segment as {u16 text offset, u16 movie id, u16 0}; they are
// exported to data/phrases.json by tools/extract_tables.py.
