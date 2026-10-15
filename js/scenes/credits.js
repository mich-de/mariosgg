// Credits (overlay 5fac): menu bar hidden, CREDITS1 (Pak 600) for 120 ticks or until a tap/key.
export class Credits {
  async enter() {
    const e = this.e;
    e.setPalette(1000);
    if (e.menubar) e.menubar.visible = false;
    await e.ticks(120);
    e.app.mainMenu(true);
  }
  render(s) {
    s.clear(0);
    this.e.gfx.bg(600);
  }
  pointerUp() {
    this.e.app.mainMenu(true);
  }
  key() {
    this.e.app.mainMenu(true);
  }
}
