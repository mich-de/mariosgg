// Movie objects (module 2dd5) driving the timeline player (DrawMovieAt 2d21:077f, sounds 2d21:0986).
// Time is in 1/600 s; every animation tick (~9.1 Hz, see TICK_MS) the movie draws at t, fires sounds, then
// advances by its step (60).

export class Movie {
  constructor(engine, id) {
    this.e = engine;
    this.id = id;
    this.res = engine.prs.movie(id);
    this.t = 0;
    this.x = this.res.h;
    this.y = this.res.v;
    this.step = this.res.step;
    this.dur = this.res.duration;
    this.paused = false;
    this.hidden = false;
    this.done = false;
    this.flip = false;
  }
  reset() {
    this.t = 0;
    this.done = false;
    this.paused = false;
  }
  // MovAdvanceOnce: stops (paused) at the end.
  advanceOnce() {
    if (this.paused) return;
    this.t += this.step;
    if (this.t >= this.dur) {
      this.t = this.dur;
      this.paused = true;
      this.done = true;
    }
  }
  // MovAdvanceLoop: wraps to the start.
  advanceLoop() {
    if (this.paused) return;
    this.t += this.step;
    if (this.t >= this.dur) {
      this.t = 0;
      this.done = true;
    }
  }
  *active(t) {
    for (const r of this.res.recs) {
      if (r.type === 10) return;
      if (r.start + r.dur <= t) continue;
      if (r.start > t) return;
      yield r;
    }
  }
  draw(clip) {
    if (this.hidden) return;
    const t = Math.min(this.t, this.dur - 1);
    const g = this.e.gfx;
    const pak = this.e.prs.pak(this.res.pakId);
    for (const r of this.active(t)) {
      if (r.type < 3 || r.type > 6) continue;
      const f = pak.frames[r.arg];
      if (!f) continue;
      const o = this.res.offs[r.arg] || { h: 0, v: 0 };
      let x = this.x + o.h, y = this.y + o.v;
      if (r.type === 5 || r.type === 6) {
        x += r.h;
        y += r.v;
      }
      if (clip) g.s.setClip(clip);
      g.s.blit(f, x, y);
      if (clip) g.s.setClip(null);
    }
  }
  sounds() {
    if (this.paused) return;
    const t = this.t;
    const prev = t >= this.step ? t - this.step : 0;
    for (const r of this.active(t)) {
      if ((r.type === 7 || r.type === 8) && (prev === 0 || r.start > prev)) this.e.audio.playSnd(r.arg, r.type === 8);
      else if (r.type === 9) this.e.audio.stopSnd();
    }
  }
  // Bounding box of what the movie draws at its current time.
  bounds() {
    const t = Math.min(this.t, this.dur - 1);
    const pak = this.e.prs.pak(this.res.pakId);
    let l = 1e9, tp = 1e9, r = -1e9, b = -1e9;
    for (const rec of this.active(t)) {
      if (rec.type < 3 || rec.type > 6) continue;
      const f = pak.frames[rec.arg];
      if (!f) continue;
      const o = this.res.offs[rec.arg] || { h: 0, v: 0 };
      let x = this.x + o.h + f.x, y = this.y + o.v + f.y;
      if (rec.type === 5 || rec.type === 6) {
        x += rec.h;
        y += rec.v;
      }
      l = Math.min(l, x); tp = Math.min(tp, y); r = Math.max(r, x + f.w); b = Math.max(b, y + f.h);
    }
    return r < l ? null : { l, t: tp, r, b };
  }
}
