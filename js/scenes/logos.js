// Publisher logos (overlay 7454): Interplay (palette 111, Pak 500, voice 8039) then Presage
// (palette 112, Pak 501, sound 8042), ~2.5 s each. A tap skips straight to the main menu.

export class Logos {
  async enter() {
    const e = this.e;
    this.stage = 0;
    this.show(500, 111, 8039);
    await e.ticks(28);
    this.stage = 1;
    this.show(501, 112, 8042);
    await e.ticks(25);
    e.app.intro();
  }
  show(pak, pal, snd) {
    this.pak = pak;
    this.e.setPalette(pal);
    this.e.audio.playSnd(snd);
  }
  render(s) {
    s.clear(0);
    if (this.pak) this.e.gfx.bg(this.pak);
  }
  pointerUp() {
    this.e.app.mainMenu();
  }
  key(k) {
    if (k === "Escape" || k === "Enter" || k === " ") this.e.app.mainMenu();
  }
}
