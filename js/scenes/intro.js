// Title intro (overlay 7682): dark stage with Mario's silhouette, lights buzz on, snare roll,
// cymbal crash, Mario introduces the gallery, applause, then the easel flips to the menu and
// the main music starts.

import { Talker } from "../engine/talker.js";
import { TABLES } from "../data/tables.js";

export class Intro {
  async enter() {
    const e = this.e;
    e.setPalette(1000);
    this.bgId = 708; // IntroDimBKG
    const sp = (this.sp = e.sprites());
    sp.create(133, 53, 709, 0, 1234); // DarkBod silhouette
    sp.create(45, 55, 710, 0, 1235, true); // lit easel
    sp.create(154, 104, 1010, 0, 100, true);
    sp.create(180, 49, 1014, 0, 1014, true);
    sp.create(189, 107, 1100, 0, 1500, true);
    sp.create(115, 80, 1020, 0, 200, true);
    this.hand = e.movie(1111); // hand holding the checker, last frame
    this.hand.x = 242;
    this.hand.y = 79;
    this.hand.t = this.hand.dur - 1;
    this.hand.paused = true;
    this.hand.hidden = true;
    this.talker = new Talker(e, { base: 12000, x: 183, y: 51, table: TABLES.intro });
    this.talker.hidden = true;
    this.flip = null;

    await e.ticks(15);
    sp.hide(1234);
    for (const id of [100, 200, 1500, 1014]) sp.show(id);
    sp.show(1235);
    this.hand.hidden = false;
    sp.toFront(200);
    sp.toFront(1500);
    await this.snd(5012); // lights buzz
    await e.ticks(2);
    await this.snd(5000); // snare roll
    await this.snd(5001); // crash + audience
    await e.ticks(5);
    this.talker.hidden = false;
    await this.talker.sayText(12091, "");
    e.audio.stopSnd();
    await this.snd(5011); // applause
    sp.delete(1234);
    sp.delete(1235);
    this.bgId = 1001;
    this.flip = e.movie(1125); // FlipBoard
    this.flip.x = 46;
    this.flip.y = 56;
    this.flip.paused = true;
    e.audio.playMusic(130);
    this.flip.paused = false;
    while (!this.flip.done) await e.ticks(1);
    e.app.mainMenu(false);
  }
  snd(id) {
    return this.e.audio.playSnd(id).then(() => this.e.check(this.token));
  }
  tick() {
    this.talker.tick();
    if (this.flip) {
      this.flip.sounds();
      this.flip.advanceOnce();
    }
  }
  render(s) {
    const g = this.e.gfx;
    s.clear(0);
    g.bg(this.bgId);
    if (this.flip) this.flip.draw();
    this.sp.draw();
    this.talker.draw();
    this.hand.draw();
  }
  pointerUp() {
    this.e.app.mainMenu(false);
  }
  key(k) {
    if (k === "Escape" || k === "Enter" || k === " ") this.e.app.mainMenu(false);
  }
}
