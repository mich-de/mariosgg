// Backgammon (overlays 5f80 intro, 5a32 game), ported from the original state machines: set-up
// (5a32:0b27 / 0cba), the roll for the first move (2b5b), the dice (2d97 / 4577 / 47b5), the
// player's turn (1d4f) and clicks (window procedure 03e4), Mario's turn (0ea8) with his rules of
// thumb (134f), pieces walking point to point (30f0 / 3d1b, menu "Animated Pieces"), hits
// (4188 / 433b), idle chatter (20b9), the end (34e7) and New Game (3787).
// The rules are the original's, simpler than tournament backgammon: a piece moves by one die
// at a time onto an empty point, an own point or a single enemy piece, and nothing forces the
// use of both dice. Points 0..11 run left->right along the top, 12..23 right->left along the
// bottom; the player goes 0 -> 23 and bears off at the bottom left, Mario 23 -> 0 at the top left.
// Board geometry (4faf / 5056): every point has a base position for shells (Koopa) and eggs
// (Yoshi); the n-th piece goes 4 px further along the point (3 px for eggs on the bottom row)
// with a 1 px perspective lean, and every 5 pieces the stack shifts 2 px sideways.

import { GameBase, rnd } from "./base.js";
import { TABLES } from "../data/tables.js";

const SHELL = [[27, 92], [48, 92], [69, 92], [89, 92], [109, 92], [129, 92], [173, 92], [194, 92], [215, 92], [235, 92], [256, 92], [277, 92], [295, 173], [272, 173], [248, 173], [225, 173], [200, 173], [176, 173], [127, 173], [104, 173], [80, 173], [55, 173], [32, 173], [7, 173]];
const EGG = [[29, 91], [50, 91], [69, 91], [89, 91], [111, 91], [131, 91], [175, 91], [196, 91], [217, 91], [237, 91], [258, 91], [278, 91], [297, 169], [273, 169], [249, 169], [225, 169], [201, 169], [178, 169], [129, 169], [105, 169], [82, 169], [57, 169], [34, 169], [10, 169]];
const HX = [26, 47, 67, 87, 108, 128, 172, 193, 213, 234, 254, 274, 292, 268, 244, 221, 197, 174, 124, 100, 77, 53, 29, 7];
// where a walking piece stands in front of each point (DS:083c shells, DS:08a0 eggs); the first
// pair is index -1, i.e. the words just before each table in memory
const LANE = {
  shell: [[279, 108], [18, 108], [41, 108], [64, 108], [87, 108], [110, 108], [134, 100], [171, 108], [194, 108], [217, 108], [240, 108], [263, 108], [287, 108], [266, 130], [243, 130], [220, 130], [197, 130], [174, 130], [134, 122], [107, 130], [84, 130], [61, 130], [38, 130], [15, 130], [-20, 100], [-23, 122]],
  egg: [[-23, 122], [15, 111], [38, 111], [61, 111], [84, 111], [107, 111], [130, 102], [169, 111], [192, 111], [215, 111], [238, 111], [261, 111], [285, 112], [266, 133], [243, 133], [220, 133], [197, 133], [174, 133], [130, 124], [102, 133], [79, 133], [56, 133], [33, 133], [10, 133], [-24, 102], [-29, 124]],
};
const lane = (type, i) => LANE[type][i + 1];
// pieces on the bar (DS:0c4c / 0c54): [player's, Mario's]; they stack 3 px apart, five deep
const BAR = { shell: [[152, 173], [152, 92]], egg: [[154, 169], [154, 91]] };
// where the last step off the board starts (3c7e)
const OFF = { p: { shell: [-23, 122], egg: [-29, 124] }, m: { shell: [-20, 100], egg: [-24, 102] } };
// walking movies (MuV 4031..4073): walk / jump over the bar / turn the corner, getting off a
// stack (out) and onto one (in), each for eggs and shells
const MV = {
  egg: { walkL: 4034, walkR: 4035, jumpL: 4036, jumpR: 4037, turn: 4032, around: 4031, outR: 4060, outL: 4061, inR: 4062, inL: 4063 },
  shell: { walkL: 4044, walkR: 4045, jumpL: 4046, jumpR: 4047, turn: 4043, around: 4041, outR: 4070, outL: 4071, inR: 4072, inL: 4073 },
};
const LEFTWARD = new Set([4031, 4034, 4036, 4041, 4044, 4046]); // 3cd4: lands facing left
const JUMPS = new Set([4036, 4037, 4046, 4047]); // 3af2: not shortened when chained
const STEPS = new Set([4031, 4032, 4034, 4035, 4036, 4037, 4041, 4043, 4044, 4045, 4046, 4047]); // 3aae
// opening position, in the order the pieces come out (DS:0b54)
const SETUP = [["p", 0, 2], ["m", 5, 5], ["m", 7, 3], ["p", 11, 5], ["m", 12, 5], ["p", 16, 3], ["p", 18, 5], ["m", 23, 2]];
const DICE_AT = { m: [[40, 37], [67, 37], [40, 61], [67, 61]], p: [[227, 37], [257, 37], [227, 61], [257, 61]] }; // 47b5
const SPIN_X = { m: [38, 65], p: [225, 255] }; // 4577, y 35
const CUP_AT = { m: [9, 28], p: [293, 28] };
// click areas (DS:0924): points, the bar, the bear-off box
const POINT_RECT = (i) => (i < 12 ? { l: HX[i], t: 93, r: HX[i] + 21, b: 129 } : { l: HX[i], t: 156, r: HX[i] + 21, b: 186 });
const BAR_RECT = { l: 145, t: 140, r: 170, b: 185 };
const inRect = (r, x, y) => x >= r.l && x < r.r && y >= r.t && y < r.b;
// phrase lists (DS:0ad4 ...)
const L = {
  greet: [4, 0, 3],
  praise: [5, 7, 9],
  thinking: [32, 31, 30],
  hitMario: [54, 25],
  stuckMario: [34, 33, 36],
  stuckPlayer: [13, 14, 17],
};

class BackgammonIntro {
  constructor(next) {
    this.next = next;
  }
  async enter() {
    const e = this.e;
    e.setPalette(1000);
    if (e.menubar) e.menubar.visible = false;
    this.mv = e.movie(4999);
    this.mv.x = -100;
    this.mv.y = 126;
    e.audio.playMusic(140, false);
    while (!this.mv.done) await e.ticks(1);
    this.go();
  }
  go() {
    if (this.gone) return;
    this.gone = true;
    if (this.e.menubar) this.e.menubar.visible = true;
    this.e.setScene(this.next);
  }
  tick() {
    this.mv.sounds();
    this.mv.advanceOnce();
  }
  render(s) {
    s.clear(0);
    this.e.gfx.bg(4000);
    this.mv.draw();
  }
  pointerUp() {
    this.go();
  }
  key() {
    this.go();
  }
}

export default class Backgammon extends GameBase {
  constructor(opts = {}) {
    super();
    this.opts = opts;
  }
  enter() {
    if (!this.opts.skipIntro && !this.introDone) {
      this.introDone = true;
      return this.e.setScene(new BackgammonIntro(this));
    }
    return this.start();
  }
  start() {
    const e = this.e;
    this.setup({
      bg: 4001,
      talker: { base: 11000, x: 133, y: 15 },
      captionFont: 224,
      captionRect: { l: 0, t: 191, r: 320, b: 200 },
      table: TABLES.backgammon,
    });
    this.sp.create(113, 56, 2505, 0, 0x11f3);
    this.playerYoshi = true;
    this.pts = Array.from({ length: 24 }, () => ({ who: null, n: 0 }));
    this.barStack = { p: [], m: [] }; // positions of the pieces on the bar
    this.off = { p: 0, m: 0 };
    this.d = [0, 0]; // dice still to play (0 = used)
    this.dbl = false;
    this.dv = 0;
    this.diceShown = []; // [{side, k, v, used}]
    this.cup = null; // {side, frame}
    this.hi = new Set(); // highlighted points
    this.barHi = null;
    this.offHi = 0;
    this.hover = -1;
    this.flying = [];
    this.walkMv = null;
    this.spin = [null, null];
    this.badges = false;
    this.whose = null;
    this.state = "intro";
    this.ready = false;
    this.started = false;
    this.playerHits = 0;
    this.idleCount = 200;
    this.lastIdleMv = -1;
    this.lastIdleSay = -1;
    e.run(() => this.flow());
  }
  get anim() {
    return this.e.prefs.animated !== false;
  }
  typeOf(who) {
    return (who === "p") === this.playerYoshi ? "egg" : "shell";
  }

  // ---------------------------------------------------------------- set-up (0b27 / 0cba / 2b5b)
  async flow() {
    const e = this.e;
    await this.wait(1);
    await this.askNameOnce();
    await this.sayRandom(L.greet);
    await this.waitTalk();
    await this.say(58); // "Do you want to play as a Yoshi, or as a Koopa?"
    await this.waitTalk();
    await this.wait(2);
    this.playerYoshi = (await this.dlgPlayAs()) === "yoshi";
    this.badges = true;
    for (const [who, pt, n] of SETUP) {
      await this.wait(1);
      e.audio.playSnd(5042);
      for (let k = 0; k < n; k++) {
        await this.wait(1);
        this.addPiece(pt, who);
      }
      await this.wait(1);
    }
    let who = await this.rollForFirst();
    for (;;) {
      const over = who === "p" ? await this.playerTurn() : await this.marioTurn();
      if (over) return this.endGame();
      who = who === "p" ? "m" : "p";
    }
  }
  // one die each (2b5b); Mario's never equals the player's; the higher one starts (Mario on a tie)
  async rollForFirst() {
    this.whose = "p";
    this.firstRoll = true;
    this.showCup("p", 2);
    this.rolled = false;
    this.say(18); // "Let's roll to see who goes first."
    this.state = "roll";
    this.rollAllowed = true;
    while (this.talker.talking && !this.rolled) await this.wait(1);
    this.talker.idle();
    this.idleCount = 200;
    while (!this.rolled) await this.idleWait();
    while (!this.ready) await this.wait(1);
    const mine = this.d[0] + this.d[1];
    await this.wait(6);
    this.whose = "m";
    await this.marioReaches();
    await this.roll("m", mine);
    const his = this.d[0] + this.d[1];
    await this.wait(10);
    await this.say(mine > his ? 20 : 19);
    await this.waitTalk();
    await this.wait(10);
    this.sayText("");
    this.firstRoll = false;
    return mine > his ? "p" : "m";
  }
  // Mario snaps his fingers and grabs the dice (movie 4021, his head hidden meanwhile)
  async marioReaches() {
    this.talker.hidden = true;
    this.e.audio.stopSnd();
    const m = this.playMovie(4021, 90, 12);
    await this.movieDone(m);
    this.talker.hidden = false;
    this.talker.idle();
  }

  // ---------------------------------------------------------------- dice (2aa3 / 2d97)
  async playerRoll() {
    this.state = "busy";
    this.showCup("p", 3);
    await this.wait(1);
    this.e.audio.playSnd(5024);
    await this.wait(6);
    this.showCup("p", 2);
    await this.wait(3);
    this.showCup(null);
    this.rolled = true;
    await this.roll("p");
  }
  // first roll: one die (the player's shows as the right-hand one); otherwise two, the higher
  // first, both spinning; doublets add two more dice
  async roll(who, beat = 0) {
    const e = this.e;
    this.ready = false;
    if (!this.firstRoll) this.diceShown = [];
    let a, b;
    if (this.firstRoll) {
      if (who === "p") [a, b] = [0, 1 + rnd(6)];
      else {
        a = 1 + rnd(6);
        if (a === beat) a = a > 1 ? a - 1 : a + 1;
        b = 0;
      }
    } else {
      a = 1 + rnd(6);
      b = 1 + rnd(6);
      if (a < b) [a, b] = [b, a];
    }
    this.d = [a, b];
    this.dbl = false;
    this.dv = 0;
    await this.wait(1);
    const which = this.firstRoll ? [who === "m" ? 0 : 1] : [0, 1];
    for (const k of which) {
      const m = e.movie(4020);
      const n = Math.floor(m.dur / m.step);
      m.t = (k === 0 ? rnd(2) * 2 + 1 : rnd(2) * 2) * m.step;
      m.dur = m.t + (n - 5) * m.step;
      m.x = SPIN_X[who][k];
      m.y = 35;
      this.spin[k] = m;
    }
    e.audio.playSnd(5019);
    while (this.spin[0] || this.spin[1]) {
      await this.wait(1);
      for (const k of [0, 1]) {
        const m = this.spin[k];
        if (m && m.done) {
          this.spin[k] = null;
          this.diceShown.push({ side: who, k, v: this.d[k], used: false });
        }
      }
    }
    if (!this.firstRoll && a === b) {
      this.dbl = true;
      this.dv = a;
      await this.wait(3);
      this.diceShown.push({ side: who, k: 2, v: a, used: false }, { side: who, k: 3, v: a, used: false });
    }
    this.ready = true;
  }
  // 4964: the die the move used goes dark
  useDie(who, mv) {
    let amt = who === "p" ? (mv.fromBar ? mv.to + 1 : mv.to - mv.from) : mv.fromBar ? 24 - mv.to : mv.from - mv.to;
    if (mv.bearOff) amt = this.d[mv.bearDie];
    const shown = (k) => this.diceShown.find((s) => s.k === k && !s.used);
    if (this.d[0] === amt && shown(0)) {
      shown(0).used = true;
      this.d[0] = 0;
    } else if (this.d[1] === amt && shown(1)) {
      shown(1).used = true;
      this.d[1] = 0;
    } else if (this.dbl) {
      if (this.d[0] === amt && shown(2)) shown(2).used = true;
      else if (this.d[1] === amt && shown(3)) shown(3).used = true;
    }
  }
  dice() {
    return this.dbl ? [this.d[0], this.d[1], this.dv, this.dv] : [this.d[0], this.d[1]];
  }

  // ---------------------------------------------------------------- rules (296d / 2357 / 2514 / 29a3 / 38a8 / 38ed)
  owner(i) {
    return this.pts[i].who;
  }
  count(i) {
    return this.pts[i].n;
  }
  enemies(i, who) {
    const p = this.pts[i];
    return p.who && p.who !== who ? p.n : 0;
  }
  open(i, who) {
    return !this.pts[i].who || this.pts[i].who === who || this.enemies(i, who) === 1;
  }
  allHome(who) {
    if (this.barStack[who].length) return false;
    const [a, b] = who === "p" ? [0, 17] : [6, 23];
    for (let i = a; i <= b; i++) if (this.pts[i].who === who) return false;
    return true;
  }
  rearmost(who) {
    if (who === "p") {
      for (let i = 0; i < 24; i++) if (this.pts[i].who === "p") return i;
    } else for (let i = 23; i >= 0; i--) if (this.pts[i].who === "m") return i;
    return -1;
  }
  piecesLeft(who) {
    return this.pts.reduce((s, p) => s + (p.who === who ? p.n : 0), 0);
  }
  canMoveFrom(i) {
    if (this.pts[i].who !== "p") return false;
    for (const d of this.dice()) if (d && i + d <= 23 && this.open(i + d, "p")) return true;
    if (!this.allHome("p")) return false;
    for (const d of this.dice()) if (d && i + d === 24) return true;
    if (this.rearmost("p") === i) for (const d of this.dice()) if (d && i + d > 23) return true;
    return false;
  }
  canMove() {
    if (this.barStack.p.length) return [this.d[0], this.d[1]].some((d) => d && this.open(d - 1, "p"));
    for (let i = 0; i < 24; i++) if (this.canMoveFrom(i)) return true;
    return false;
  }
  legalTarget(t) {
    if (!this.open(t, "p")) return false;
    if (this.barStack.p.length) return this.dice().some((d) => d && t + 1 === d);
    return this.dice().some((d) => d && t - d === this.src);
  }
  // which die bears the selected piece off (38ed): exact first, else a higher one for the rearmost
  bearDie() {
    if (!this.allHome("p") || this.src < 0) return -1;
    const [a, b] = this.d, dv = this.dbl ? this.dv : 0;
    if (a && (this.src + a === 24 || (dv && this.src + dv === 24))) return 0;
    if (b && (this.src + b === 24 || (dv && this.src + dv === 24))) return 1;
    if (this.rearmost("p") !== this.src) return -1;
    if ((a && 24 - a <= this.src) || (dv && 24 - dv <= this.src)) return a ? 0 : 1;
    if ((b && 24 - b <= this.src) || (dv && 24 - dv <= this.src)) return b ? 1 : 0;
    return -1;
  }

  // ---------------------------------------------------------------- the board
  stackPos(i, k, type) {
    const row = k % 5, grp = (k / 5) | 0;
    const base = type === "egg" ? EGG[i] : SHELL[i];
    let x = base[0], y = base[1];
    const q = (i / 4) | 0;
    y += (i < 12 ? 1 : -1) * (i >= 12 && type === "egg" ? 3 : 4) * row;
    if (q === 0 || q === 3) x -= row;
    if (q === 2 || q === 5) x += row;
    x += (i <= 5 || i >= 18 ? -2 : 2) * grp;
    return [x, y];
  }
  addPiece(i, who) {
    this.pts[i].who = who;
    this.pts[i].n++;
  }
  removePiece(i) {
    const p = this.pts[i];
    if (p.n) p.n--;
    if (!p.n) p.who = null;
  }
  barSlot(who) {
    const side = who === "p" ? 0 : 1;
    const [x, y] = BAR[this.typeOf(who)][side];
    const k = this.barStack[who].length % 5;
    return [x, y + (side ? 3 : -3) * k];
  }
  showCup(side, frame = 2) {
    this.cup = side ? { side, frame } : null;
  }
  clearHighlights() {
    this.hi.clear();
    this.barHi = null;
    this.hover = -1;
  }
  highlight(i, sound) {
    this.hi.add(i);
    if (sound) this.e.audio.playSnd(sound === 1 ? 5053 : 5054);
  }
  // a sprite gliding in a straight line, one step per tick (3c63:0114)
  fly(frame, x0, y0, x1, y1, n) {
    n = Math.max(1, n);
    return new Promise((done) => this.flying.push({ frame, x0, y0, x1, y1, n, t: 0, x: x0, y: y0, done }));
  }
  steps(x0, y0, x1, y1) {
    return (Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) / 14) | 0; // 548a
  }

  // ---------------------------------------------------------------- the player's turn (1d4f)
  async playerTurn() {
    this.whose = "p";
    this.diceShown = [];
    this.showCup("p", 2);
    this.clearHighlights();
    this.ready = false;
    this.started = true;
    this.rolled = false;
    this.rollAllowed = true;
    this.idleCount = 200;
    this.state = "roll";
    while (!this.rolled) await this.idleWait();
    while (!this.ready) await this.wait(1);
    this.movesLeft = this.dbl ? 4 : 2;
    if (this.dbl && this.canMove()) this.say(23); // "Doubles! You get four moves!"
    for (;;) {
      await this.waitTalk();
      this.talker.idle();
      this.idleCount = 200;
      this.sel = null;
      this.confirmed = null;
      this.clearHighlights();
      this.offHi = 0;
      if (!this.canMove()) {
        await this.playerStuck();
        return false;
      }
      this.state = "move";
      while (!this.confirmed) await this.idleWait();
      this.state = "busy";
      const mv = this.confirmed;
      this.useDie("p", mv);
      if (mv.fromBar) await this.leaveBar("p");
      await this.walkPiece("p", mv);
      this.clearHighlights();
      this.offHi = 0;
      if (!this.piecesLeft("p")) return true;
      if (--this.movesLeft === 0) return false;
      if (this.dbl && this.movesLeft === 2) this.d = [this.dv, this.dv];
    }
  }
  async playerStuck() {
    this.state = "busy";
    await this.wait(20);
    await this.sayRandom(L.stuckPlayer);
    await this.waitTalk();
    this.talker.idle();
    await this.wait(20);
    this.sayText("");
  }
  // one tick of waiting for the player; after 20 s without input Mario fidgets or nags (20b9)
  async idleWait() {
    await this.wait(1);
    if (this.idleBusy || this.talker.talking) return;
    if (--this.idleCount > 0) return;
    this.idleBusy = true;
    if (rnd(2) === 0) {
      let k;
      do k = rnd(3);
      while (k === this.lastIdleMv);
      this.lastIdleMv = k;
      const id = [9000, 9001, 9002][k];
      this.talker.hidden = true;
      const m = this.playMovie(id, id === 9001 ? 114 : 115, 15);
      await this.movieDone(m);
      this.talker.hidden = false;
      this.talker.idle();
    } else {
      let k;
      do k = rnd(4);
      while (k === this.lastIdleSay);
      this.lastIdleSay = k;
      await this.say([38, 39, 37, this.whose === "p" && this.ready && this.canMove() ? 22 : 39][k]);
      await this.waitTalk();
      this.talker.idle();
    }
    this.idleCount = 200;
    this.idleBusy = false;
  }
  // a word once (22cd): "You gotta move off the bar first.", "I don't think you can go there."
  async hint(i) {
    if (this.hinting || this.walkMv || this.idleBusy) return;
    this.hinting = true;
    this.idleCount = 200;
    await this.say(i);
    await this.waitTalk();
    this.talker.idle();
    this.idleCount = 200;
    this.hinting = false;
  }

  // ---------------------------------------------------------------- Mario's turn (0ea8 / 134f)
  async marioTurn() {
    this.whose = "m";
    this.state = "mario";
    this.diceShown = [];
    this.clearHighlights();
    this.showCup("m", 2);
    this.ready = false;
    if (!this.barStack.m.length && this.started && rnd(2)) {
      await this.sayRandom(L.praise);
      await this.waitTalk();
      this.talker.idle();
    }
    await this.wait(3);
    await this.marioReaches();
    this.showCup(null);
    await this.roll("m");
    this.movesLeft = this.dbl ? 4 : 2;
    if (this.dbl) this.say(24); // "Hey, I got doubles!"
    else if (this.started) this.sayRandom(L.thinking);
    for (;;) {
      await this.waitTalk();
      this.talker.idle();
      this.clearHighlights();
      if (!this.movesLeft) break;
      this.offHi = 0;
      if (this.dbl && this.movesLeft === 2) this.d = [this.dv, this.dv];
      this.movesLeft--;
      const mv = this.marioChoice();
      if (!mv) {
        if (!this.piecesLeft("m")) return true;
        await this.wait(6);
        await this.sayRandom(L.stuckMario);
        await this.waitTalk();
        this.talker.idle();
        await this.wait(3);
        return false;
      }
      if (mv.fromBar) this.barHi = "m";
      else this.highlight(mv.from, 1);
      if (this.enemies(mv.to, "m") <= 1 && !(mv.to === 0 && mv.bearOff)) this.highlight(mv.to, 2);
      this.useDie("m", mv);
      const flight = mv.fromBar ? this.leaveBar("m") : null;
      if (this.enemies(mv.to, "m") === 1 && !mv.bearOff) {
        await this.sayRandom(L.hitMario);
        await this.waitTalk();
        this.talker.idle();
        this.sayText("");
      }
      if (flight) await flight;
      await this.wait(6);
      await this.walkPiece("m", mv);
      if (!(this.movesLeft && this.piecesLeft("m"))) break;
    }
    await this.wait(3);
    if (!this.piecesLeft("m")) return true;
    await this.say(rnd(2) === 1 ? 11 : 16); // "It's your turn." / "Your roll."
    await this.waitTalk();
    return false;
  }
  // 134f: off the bar first; then bearing off when he can, else in this order: cover a blot or
  // bring a blot home (1722), build on a point with doublets (1a79), move a spare piece out of
  // reach (1893), hit (1818), and finally anything from the back (1982)
  marioChoice() {
    const [d1, d2] = this.d;
    const own = (i) => i >= 0 && i < 24 && this.pts[i].who === "m";
    const empty = (i) => !this.pts[i].who;
    const ok = (i) => this.open(i, "m");
    const contact = this.rearmost("m") > this.rearmost("p");
    const mv = (from, to, extra = {}) => ({ from, to, ...extra });
    if (this.barStack.m.length) {
      const e1 = 24 - d1, e2 = 24 - d2, both = 24 - (d1 + d2);
      const bothOk = both >= 0 && both < 24 && (own(both) || empty(both));
      let to = -1;
      if (d1 && this.enemies(e1, "m") === 1) to = e1;
      else if (d2 && this.enemies(e2, "m") === 1) to = e2;
      else if (d1 && own(e1) && this.count(e1) === 1) to = e1;
      else if (d2 && own(e2) && this.count(e2) === 1) to = e2;
      else if (d1 && (own(e1) || empty(e1)) && bothOk) to = e1;
      else if (d2 && (own(e2) || empty(e2)) && bothOk) to = e2;
      else if (d1 && (own(e1) || empty(e1))) to = e1;
      else if (d2 && (own(e2) || empty(e2))) to = e2;
      return to < 0 ? null : mv(23, to, { fromBar: true });
    }
    const cover = () => {
      if (!contact) return null;
      for (let i = 0; i < 24; i++) {
        if (!own(i)) continue;
        for (const d of [d1, d2]) {
          if (!d || i - d < 0) continue;
          const t = i - d;
          if (this.count(i) > 2 && own(t) && this.count(t) === 1) return mv(i, t);
          if (this.count(i) === 1 && own(t)) return mv(i, t);
        }
      }
      return null;
    };
    const build = () => {
      if (!contact) return null;
      if (d1 === d2)
        for (let i = 23; i >= 0; i--) {
          if (!own(i) || this.count(i) !== 2) continue;
          for (const d of [d1, d2]) if (d && i - d >= 0 && ok(i - d)) return mv(i, i - d);
        }
      for (let i = 23; i >= 0; i--) {
        if (!own(i) || this.count(i) <= 2) continue;
        const t = d1 && i - d1 >= 0 ? i - d1 : d2 && i - d2 >= 0 ? i - d2 : -1;
        if (t >= 0 && own(t)) return mv(i, t);
      }
      return null;
    };
    const exposed = (t) => {
      if (t < 6 && this.barStack.p.length) return true;
      for (let j = t; j >= Math.max(0, t - 6); j--) if (this.pts[j].who === "p") return true;
      return false;
    };
    const safe = () => {
      for (let i = 23; i >= 6; i--) {
        if (!own(i) || (this.count(i) !== 1 && this.count(i) <= 2)) continue;
        for (const d of [d1, d2]) if (d && i - d > 0 && ok(i - d) && !exposed(i - d)) return mv(i, i - d);
      }
      return null;
    };
    const hit = () => {
      for (let i = 0; i < 24; i++) {
        if (this.enemies(i, "m") !== 1) continue;
        for (const d of [d1, d2]) if (d && i + d <= 23 && own(i + d)) return mv(i + d, i);
      }
      return null;
    };
    const any = () => {
      if (contact)
        for (let i = 23; i >= 0; i--) {
          if (!own(i) || !(this.count(i) > 2 || (this.count(i) === 2 && d1 === d2))) continue;
          for (const d of [d1, d2]) if (d && i - d >= 0 && ok(i - d)) return mv(i, i - d);
        }
      for (let i = 23; i >= 0; i--) {
        if (!own(i)) continue;
        for (const d of [d1, d2]) if (d && i - d >= 0 && ok(i - d)) return mv(i, i - d);
      }
      return null;
    };
    const bearOff = () => {
      const off = (i, k) => mv(i, 0, { bearOff: true, bearDie: k });
      for (let i = 0; i <= 5; i++) {
        if (!own(i) || this.count(i) <= 2) continue;
        if (d1 && i + 1 === d1) return off(i, 0);
        if (d2 && i + 1 === d2) return off(i, 1);
      }
      for (let i = 0; i <= 5; i++) {
        if (!own(i)) continue;
        if (d1 && i + 1 === d1) return off(i, 0);
        if (d2 && i + 1 === d2) return off(i, 1);
      }
      const r = this.rearmost("m");
      if (d1 && r < d1) return off(r, 0);
      if (d2 && r < d2) return off(r, 1);
      return null;
    };
    if (this.allHome("m")) return bearOff() || cover() || build() || hit() || any();
    return cover() || build() || safe() || hit() || any();
  }

  // ---------------------------------------------------------------- moving a piece (30f0)
  // off the bar first (1490): the piece flies to the start of its lane
  async leaveBar(who) {
    const type = this.typeOf(who);
    const from = this.barStack[who].pop();
    const [x1, y1] = who === "p" ? lane(type, 0) : lane(type, 22);
    const f = this.fly(type === "egg" ? 0 : 1, from[0], from[1], x1, y1, this.steps(from[0], from[1], x1, y1));
    this.e.audio.playSnd(5072);
    await f;
  }
  openWalk(id, x, y) {
    if (this.walkMv && this.walkMv.id !== id) this.walkMv = null;
    const m = this.e.movie(id);
    m.x = x;
    m.y = y;
    this.walkMv = m;
    return m;
  }
  async walkEnd() {
    while (this.walkMv && !this.walkMv.done) await this.wait(1);
  }
  // where a piece leaves or reaches a point (3b98)
  standAt(type, pos) {
    if (pos === 12) {
      const [x, y] = lane(type, 12);
      return [x + 23, y];
    }
    if (pos === 5) return type === "egg" ? [130, 111] : [134, 108];
    if (pos === 18) return type === "egg" ? [130, 133] : [134, 130];
    return lane(type, pos < 12 ? pos : pos - 1);
  }
  // the next step from pos (3d1b): [movie, x, y], or null once there
  nextStep(who, type, pos, dest) {
    if (pos === dest) return null;
    const T = MV[type];
    if (who === "m") {
      let [x, y] = lane(type, pos - 1);
      if (pos === 12 && type === "shell") [x, y] = lane("shell", -1);
      if (pos < 12) return [pos === 6 ? T.jumpL : T.walkL, x, y];
      return [pos === 18 ? T.jumpR : pos === 12 ? T.around : T.walkR, x, y];
    }
    const [x, y] = lane(type, pos);
    if (pos < 12) return [pos === 5 ? T.jumpR : pos === 11 ? T.turn : T.walkR, x, y];
    return [pos === 17 ? T.jumpL : T.walkL, x, y];
  }
  async walkPiece(who, mv) {
    const type = this.typeOf(who), T = MV[type];
    const anim = this.anim;
    const dest = mv.bearOff ? (who === "p" ? 23 : 0) : mv.to;
    let pos = mv.fromBar ? (who === "p" ? 0 : 23) : mv.from;
    this.walkMv = null;
    if (pos === dest && !mv.bearOff) {
      if (this.enemies(dest, who) === 1) return this.hitLanding(who, dest, null);
      this.addPiece(dest, who);
      return;
    }
    // getting off the stack
    if (!mv.fromBar) this.removePiece(mv.from);
    const [sx, sy] = this.standAt(type, pos);
    const src = mv.fromBar ? (who === "p" ? -1 : 23) : mv.from;
    const right = (who === "p") === src < 12;
    let m = this.openWalk(right ? T.outR : T.outL, sx, sy);
    if (!anim) {
      m.dur = m.step;
      m.step >>= 1;
    }
    await this.walkEnd();
    let cur = m.id;
    this.walkMv = null;
    // point by point
    let chained = null;
    for (;;) {
      if (STEPS.has(cur)) pos += who === "m" ? -1 : 1;
      const next = this.nextStep(who, type, pos, dest);
      if (!next) break;
      const [id, x, y] = next;
      if (chained && chained.id !== id) chained = null;
      cur = id;
      if (!chained) {
        chained = anim ? this.e.movie(id) : null;
        if (chained && !JUMPS.has(id)) chained.dur -= chained.step;
      }
      if (chained) {
        if (who === "p" && pos + 1 === dest) chained.dur = chained.res.duration;
        chained.reset();
        chained.x = x;
        chained.y = y;
        this.walkMv = chained;
        await this.walkEnd();
        this.walkMv = null;
      } else await this.wait(1);
    }
    // landing
    if (mv.bearOff && this.allHome(who) && pos === dest) {
      const [x, y] = OFF[who][type];
      this.openWalk(T.jumpL, x, y);
      await this.walkEnd();
      this.walkMv = null;
      this.off[who]++;
      this.e.audio.playSnd(5010);
      return;
    }
    if (this.enemies(dest, who) === 1) return this.hitLanding(who, dest, cur);
    await this.landing(who, type, dest, cur);
    this.addPiece(dest, who);
  }
  async landing(who, type, dest, cur) {
    const T = MV[type];
    const [x, y] = this.standAt(type, dest);
    const m = this.openWalk(LEFTWARD.has(cur) ? T.inL : T.inR, x, y);
    if (!this.anim) {
      m.t = Math.max(0, m.dur - m.step);
      m.step >>= 1;
    }
    await this.walkEnd();
    this.walkMv = null;
  }
  // 4188 / 433b: the piece lands, the single enemy piece flies to the bar
  async hitLanding(who, dest, cur) {
    const victim = who === "p" ? "m" : "p";
    if (who === "p") this.playerHits++;
    await this.landing(who, this.typeOf(who), dest, cur);
    const vtype = this.typeOf(victim);
    const [x0, y0] = this.stackPos(dest, 0, vtype);
    this.removePiece(dest);
    const [x1, y1] = this.barSlot(victim);
    const f = this.fly(vtype === "egg" ? 0 : 1, x0, y0, x1, y1, this.steps(x0, y0, x1, y1) + 2);
    this.e.audio.playSnd(5034);
    await f;
    this.barStack[victim].push([x1, y1]);
    this.addPiece(dest, who);
    if (who === "p") {
      const say = this.playerHits % 3 === 0 ? 35 : this.playerHits % 5 === 0 ? 29 : 0;
      if (say) {
        await this.say(say); // "Oh no!" / "Oh brother!"
        await this.waitTalk();
        this.talker.idle();
      }
    }
  }

  // ---------------------------------------------------------------- end (34e7) / new game (3787)
  async endGame() {
    this.state = "over";
    this.whose = null;
    this.diceShown = [];
    this.clearHighlights();
    const marioWon = !this.piecesLeft("m");
    const r = rnd(2);
    if (marioWon) await this.say(r ? 44 : 43);
    else {
      this.e.audio.playMusic(141, false);
      await this.say(r ? 46 : 42);
    }
    await this.waitTalk();
    this.talker.idle();
    if (!marioWon) {
      // the winning pair dances at half speed
      const a = this.playMovie(4022);
      const b = this.playMovie(4023);
      b.x += 268;
      b.y += 21;
      a.step >>= 1;
      b.step >>= 1;
      this.winMovies = [a, b];
      while (this.winMovies && !(a.done && b.done)) await this.wait(1);
    }
    await this.wait(3);
    await this.say(40); // "Hey! Do you want to play another game?"
    await this.waitTalk();
    this.talker.idle();
    await this.wait(3);
    const again = await this.dlgPlayAgain({ noDx: 24, dy: 20 });
    if (this.winMovies) for (const m of this.winMovies) this.movies.splice(this.movies.indexOf(m), 1);
    this.winMovies = null;
    await this.wait(6);
    if (again) this.restart();
    else this.e.app.mainMenu(true);
  }
  async newGameRequest() {
    if (this.inDialog) return;
    this.inDialog = true;
    await this.waitTalk();
    await this.say(41); // "Are you sure you want to start another game?"
    await this.waitTalk();
    this.talker.idle();
    await this.wait(3);
    const yes = await this.dlgStartOver();
    this.inDialog = false;
    if (yes) this.restart();
  }

  // ---------------------------------------------------------------- input (03e4 / 028a)
  pointAt(x, y) {
    // the original's point boxes, made a little taller and snapped to the nearest point for touch
    const top = y >= 86 && y < 140, bottom = y >= 140 && y < 192;
    if (!top && !bottom) return -1;
    let best = -1, bd = 1e9;
    for (let i = top ? 0 : 12; i < (top ? 12 : 24); i++) {
      const d = Math.abs(x - (HX[i] + 10));
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    return bd <= 12 ? best : -1;
  }
  offRect() {
    const f = this.e.gfx.frameInfo(4011, 16);
    return { l: 19 - 2, t: 134 - 2, r: 19 + f.w + 2, b: 134 + f.h + 2 };
  }
  pointerDown(x, y) {
    this.idleCount = 200;
    if (this.winMovies) {
      for (const m of this.winMovies) this.movies.splice(this.movies.indexOf(m), 1);
      this.winMovies = null;
      return;
    }
    if (this.whose !== "p") return;
    const cupF = this.e.gfx.frameInfo(4011, 2);
    if (inRect({ l: 293 - 4, t: 28 - 4, r: 293 + cupF.w + 4, b: 28 + cupF.h + 4 }, x, y)) {
      if (!this.rolled && this.rollAllowed && this.state === "roll") {
        this.rollAllowed = false;
        this.e.run(() => this.playerRoll());
      }
      return;
    }
    if (this.state !== "move") return;
    const onBar = this.barStack.p.length > 0;
    if (inRect(BAR_RECT, x, y)) {
      if (onBar && this.sel === null && !this.confirmed && this.ready && this.canMove()) {
        this.sel = -1;
        this.src = -1;
        this.barHi = "p";
        this.e.audio.playSnd(5053);
      }
      return;
    }
    if (inRect(this.offRect(), x, y) && !onBar && this.sel !== null && this.ready) {
      const k = this.bearDie();
      if (k >= 0) {
        this.offHi = 2;
        this.e.audio.playSnd(5054);
        this.confirmed = { from: this.src, to: 23, bearOff: true, bearDie: k };
      }
      return;
    }
    const p = this.pointAt(x, y);
    if (p < 0 || this.walkMv || this.talker.talking) return;
    if (!onBar && this.sel === null && this.ready) {
      if (this.pts[p].who === "p" && this.canMoveFrom(p)) {
        this.sel = p;
        this.src = p;
        this.clearHighlights();
        this.highlight(p, 1);
        if (this.bearDie() >= 0) this.offHi = 1;
        return;
      }
    } else if (!onBar && this.sel !== null && this.ready && p === this.src) {
      this.sel = null;
      this.src = -99;
      this.clearHighlights();
      this.offHi = 0;
      this.e.audio.playSnd(5053);
      return;
    }
    if (this.sel !== null && this.ready) {
      if ((p > this.src || this.sel === -1) && this.legalTarget(p)) {
        this.highlight(p, 2);
        this.confirmed = { from: this.src, to: p, fromBar: this.sel === -1 };
      } else this.e.run(() => this.hint(12)); // "I don't think you can go there."
      return;
    }
    if (onBar && this.sel === null) this.e.run(() => this.hint(21)); // "You gotta move off the bar first."
  }
  pointerMove(x, y) {
    this.idleCount = 200;
    // with a mouse the target under the pointer lights up (2799); touch shows all of them
    if (this.e.pointer.type !== "mouse" || this.whose !== "p" || this.state !== "move" || this.sel === null || this.confirmed) return;
    const p = this.pointAt(x, y);
    const ok = p >= 0 && (p > this.src || this.sel === -1) && this.legalTarget(p);
    if (this.hover >= 0 && this.hover !== p && this.hover !== this.src) this.hi.delete(this.hover);
    this.hover = ok ? p : -1;
    if (ok) this.hi.add(p);
  }
  touchTargets() {
    if (this.e.pointer.type === "mouse" || this.whose !== "p" || this.state !== "move" || this.sel === null || this.confirmed) return [];
    const out = [];
    for (let t = 0; t < 24; t++) if ((t > this.src || this.sel === -1) && this.legalTarget(t)) out.push(t);
    return out;
  }

  // ---------------------------------------------------------------- tick / render
  tick() {
    if (!this.talker) return;
    this.tickCommon();
    for (const m of [this.walkMv, this.spin[0], this.spin[1]]) {
      if (!m) continue;
      m.sounds();
      m.advanceOnce();
    }
    for (const f of [...this.flying]) {
      f.t++;
      f.x = Math.round(f.x0 + ((f.x1 - f.x0) * f.t) / f.n);
      f.y = Math.round(f.y0 + ((f.y1 - f.y0) * f.t) / f.n);
      if (f.t >= f.n) {
        this.flying.splice(this.flying.indexOf(f), 1);
        f.done();
      }
    }
  }
  render(scr) {
    const g = this.e.gfx;
    scr.clear(0);
    g.bg(4001);
    if (!this.talker) return;
    this.drawName(257, 18);
    this.talker.drawText();
    // highlights sit under everything (sprites sent to the back)
    const hi = (i) => g.frame(4010, i < 12 ? i : 35 - i, HX[i], i < 12 ? 101 : 153);
    for (const i of this.hi) hi(i);
    for (const i of this.touchTargets()) hi(i);
    if (this.barHi === "p") g.frame(4010, 25, 150, 144);
    if (this.barHi === "m") g.frame(4010, 24, 150, 101);
    this.sp.draw();
    this.talker.draw();
    if (this.badges) {
      g.frame(4011, this.playerYoshi ? 18 : 19, 293, 54);
      g.frame(4011, this.playerYoshi ? 19 : 18, 9, 54);
    }
    if (this.cup) g.frame(4011, this.cup.frame, CUP_AT[this.cup.side][0], CUP_AT[this.cup.side][1]);
    if (this.offHi) g.frame(4011, this.offHi === 1 ? 16 : 17, 19, 134);
    // stacks: the top row in order, the bottom row nearest piece last
    for (let i = 0; i < 24; i++) {
      const p = this.pts[i];
      if (!p.n) continue;
      const type = this.typeOf(p.who), fr = type === "egg" ? 0 : 1;
      const order = [];
      for (let k = 0; k < p.n; k++) order.push(k);
      if (i >= 12) order.sort((a, b) => ((a / 5) | 0) - ((b / 5) | 0) || (b % 5) - (a % 5));
      for (const k of order) {
        const [x, y] = this.stackPos(i, k, type);
        g.frame(4011, fr, x, y);
      }
    }
    for (const who of ["p", "m"]) {
      const fr = this.typeOf(who) === "egg" ? 0 : 1;
      for (const [x, y] of this.barStack[who]) g.frame(4011, fr, x, y);
    }
    for (const s of this.diceShown) {
      const [x, y] = DICE_AT[s.side][s.k];
      g.frame(4011, s.v + (s.used ? 9 : 3), x, y);
    }
    for (const m of this.spin) if (m) m.draw();
    if (this.walkMv) this.walkMv.draw();
    for (const f of this.flying) g.frame(4011, f.frame, f.x, f.y);
    this.drawMovies();
  }
}
