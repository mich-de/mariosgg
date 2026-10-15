// Help window (overlay 73d5): HelpBKG 8000 at (0,0), page Paks drawn at (8,8), buttons from
// HelpButtons 8001 at (80,170) prev, (130,170) close, (180,170) next — frames 0-2 normal,
// 3-5 pressed, 6-8 disabled. Page turn 9201, refusal 9202, close 9204.

const PAGES = { 1: [410, 411], 2: [420, 421], 3: [430, 431, 432, 433], 4: [440, 441], 5: [450, 451, 452] };
const BTNS = [
  { x: 80, y: 170, n: 0, p: 3, d: 6, act: -1 },
  { x: 130, y: 170, n: 1, p: 4, d: 7, act: 0 },
  { x: 180, y: 170, n: 2, p: 5, d: 8, act: 1 },
];

export class Help {
  constructor(e, game) {
    this.e = e;
    this.pages = PAGES[game] || PAGES[1];
    this.page = 0;
    this.down = null;
    this.hideMenu = true;
    this.promise = new Promise((r) => (this.resolve = r));
  }
  show() {
    this.e.pushLayer(this);
    return this.promise;
  }
  disabled(b) {
    return (b.act === -1 && this.page === 0) || (b.act === 1 && this.page === this.pages.length - 1);
  }
  render(s) {
    const g = this.e.gfx;
    s.setClip(null);
    g.frame(8000, 0, 0, 0);
    g.bg(this.pages[this.page], 8, 8);
    for (const b of BTNS) g.frame(8001, this.disabled(b) ? b.d : this.down === b ? b.p : b.n, b.x, b.y);
  }
  hit(x, y) {
    return BTNS.find((b) => x >= b.x - 4 && x < b.x + 51 && y >= b.y - 4 && y < b.y + 22) || null;
  }
  pointerDown(x, y) {
    this.down = this.hit(x, y);
  }
  pointerUp(x, y) {
    const b = this.hit(x, y);
    const was = this.down;
    this.down = null;
    if (b && b === was) this.act(b.act);
  }
  act(a) {
    const au = this.e.audio;
    if (a === 0) {
      au.playSnd(9204);
      this.e.popLayer(this);
      this.resolve();
      return;
    }
    const np = this.page + a;
    if (np < 0 || np >= this.pages.length) return void au.playSnd(9202);
    this.page = np;
    au.playSnd(9201);
  }
  key(k) {
    if (k === "ArrowLeft" || k === "PageUp") this.act(-1);
    else if (k === "ArrowRight" || k === "PageDown" || k === " ") this.act(1);
    else if (k === "Escape" || k === "Enter") this.act(0);
  }
}
