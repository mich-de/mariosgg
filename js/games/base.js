// Shared plumbing for the five game screens: Mario's talking head + caption, the player's
// name plate, the standard dialogs (descriptors from overlay 65d2), New Game / Exit handling
// and the "what's taking so long?" idle nagging.

import { Talker } from "../engine/talker.js";
import { PakDialog, CMD } from "../ui/toolkit.js";

export const rnd = (n) => Math.floor(Math.random() * n);
export const pick = (a) => a[rnd(a.length)];

// 36b6:0004 — the original's random picks from a list walk through a shuffled copy and reshuffle
// it when it runs out (36b6:0032). The lists live in the data segment as {count, index, items},
// so their state carries over from one game to the next; most start with index = count (the
// first pick shuffles), a few with 0 (the first picks come in table order).
const bags = new Map();
export function bagPick(items, start = items.length) {
  const key = items.join(",");
  let b = bags.get(key);
  if (!b) bags.set(key, (b = { items: items.slice(), i: start }));
  if (++b.i >= b.items.length) {
    const a = b.items;
    for (let n = a.length; n > 1; ) {
      const j = rnd(n--);
      [a[j], a[n]] = [a[n], a[j]];
    }
    b.i = 0;
  }
  return b.items[b.i];
}

export class GameBase {
  constructor() {
    this.movies = []; // movies drawn on top of sprites, advanced every tick
    this.idleTicks = 0;
    this.busy = false;
  }
  // Called by subclasses from enter().
  setup({ bg, talker, captionFont, captionRect, table }) {
    const e = this.e;
    e.setPalette(1000);
    this.bgId = bg;
    this.sp = e.sprites();
    this.table = table;
    this.talker = new Talker(e, {
      base: talker.base,
      x: talker.x,
      y: talker.y,
      font: captionFont,
      rect: captionRect,
      table,
      textX: captionRect ? ((captionRect.r - captionRect.l) / 2) | 0 : undefined,
      textY: captionRect ? captionRect.t : undefined,
    });
  }
  // Random phrase from a list (1aec:01e2 -> 36b6:0004 shuffle bag).
  sayRandom(items) {
    return this.say(bagPick(items));
  }
  say(i) {
    return this.talker.say(i);
  }
  sayText(text) {
    return this.talker.sayText(0, text);
  }
  async waitTalk() {
    while (this.talker.talking) await this.e.ticks(1);
  }
  wait(n) {
    return this.e.ticks(n);
  }
  playMovie(id, x, y, opts = {}) {
    const m = this.e.movie(id);
    if (x !== undefined) {
      m.x = opts.add ? m.x + x : x;
      m.y = opts.add ? m.y + y : y;
    }
    m.layer = opts.layer || 0;
    this.movies.push(m);
    return m;
  }
  async movieDone(m) {
    while (!m.done) await this.e.ticks(1);
    const i = this.movies.indexOf(m);
    if (i >= 0 && !m.keep) this.movies.splice(i, 1);
  }
  // ---- standard dialogs (overlay 65d2 descriptors, absolute coordinates)
  dlgPlayAs() {
    return new PakDialog(this.e, 101, 83, 80, [
      { frame: 1, pressed: 3, x: 117 - 83, y: 132 - 80, value: "yoshi", key: ["y"] },
      { frame: 2, pressed: 4, x: 160 - 83, y: 132 - 80, value: "koopa", key: ["k"] },
    ]).show();
  }
  // Each game nudges the shared descriptors before showing them: Start Over moves up 16 px in
  // Dominoes; Play Again is shifted right by 20 (its NO button by 20 or 24) and, depending on the
  // game, 24 px up (Dominoes) or 20 px down (Yacht, Backgammon).
  dlgStartOver() {
    const dy = this.startOverDy || 0;
    return new PakDialog(this.e, 105, 80, 80 + dy, [
      { frame: 1, pressed: 3, x: 98 - 80, y: 131 - 80, value: true, key: ["y", "enter"] },
      { frame: 2, pressed: 4, x: 167 - 80, y: 131 - 80, value: false, key: ["n", "escape"] },
    ]).show();
  }
  dlgPlayAgain({ noDx = 20, dy = 0 } = {}) {
    const bx = 75 + 20;
    return new PakDialog(this.e, 106, bx, 80 + dy, [
      { frame: 1, pressed: 3, x: 87 + 20 - bx, y: 132 - 80, value: true, key: ["y", "enter"] },
      { frame: 2, pressed: 4, x: 143 + noDx - bx, y: 132 - 80, value: false, key: ["n", "escape"] },
    ]).show();
  }
  async askNameOnce() {
    const app = this.e.app;
    if (app.nameAsked) return;
    app.nameAsked = true;
    await app.askName();
  }
  // ---- menu commands
  onCommand(cmd) {
    if (cmd === CMD.NEW_GAME) {
      this.newGameRequest();
      return true;
    }
    if (cmd === CMD.EXIT_TO_MENU) {
      this.e.audio.stopMusic();
      this.e.app.mainMenu(true);
      return true;
    }
    return false;
  }
  async newGameRequest() {
    if (this.inDialog) return;
    this.inDialog = true;
    const yes = await this.dlgStartOver();
    this.inDialog = false;
    if (yes) this.restart();
  }
  restart() {
    this.e.setScene(new this.constructor({ skipIntro: true }));
  }
  // ---- per tick
  tickCommon() {
    this.talker.tick();
    for (const m of this.movies) {
      m.sounds();
      m.advanceOnce();
    }
  }
  drawMovies(layer = 0) {
    for (const m of this.movies) if ((m.layer || 0) === layer) m.draw();
  }
  // DrawTextCentered (1408:0170) cuts the string at `max` characters (11 in most games)
  drawName(x, y, font = 223, max = 11) {
    const name = this.e.prefs.name || "My Friend";
    this.e.gfx.text(font, name.slice(0, max), x, y, "center");
  }
}
