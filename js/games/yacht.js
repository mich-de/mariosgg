// Yacht (overlays 7b14 intro, 7783 game, 7a78 Mario's planner), ported from the original state
// machines: start (7783:076b), Mario's turn (08d3) with his dice choices (11c4 + 7a78) and the
// announcement of the line he scores (13e4 / 2787), the player's turn (0b34) and clicks (window
// procedure), the dice (14fd), idle chatter (0eb2 / 0fcb / 1081), the end (1632) and New Game
// (18b5). Layout (2911): score cards are part of the background; line highlights (Pak 6011) at
// (7 | 225, 29 + 11*row); scores right-aligned in two characters at x 80 | 298, y 31 + 11*row;
// totals at (73|291, 164); dice at (103 + 23*i, 145), kept ones 10 px lower; the player's
// dice-cups at (246 + 17*i, 180), Mario's at (105 + 12*i, 104).

import { GameBase, rnd } from "./base.js";
import { TABLES } from "../data/tables.js";

const ROWS = 12; // Yacht, Big Straight, Sm. Straight, 4 of a Kind, Full House, Choice, Sixes .. Aces
const ROW_SAY = [64, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]; // phrase with each line's name
const ROW_TEXT = ["YACHT", "BIG STRAIGHT", "LITTLE STRAIGHT", "FOUR OF A KIND", "FULL HOUSE", "CHOICE", "SIXES", "FIVES", "FOURS", "THREES", "DEUCES", "ACES"];
const DIE_X = (i) => 103 + 23 * i;
const JOKES = [[55, 56, 59, 60, 61], [55, 56, 65, 66, 67], [55, 56, 68, 69, 70], [55, 56, 71, 72, 73]]; // DS:5990
const L = {
  yourTurn: [19, 23, 17], // DS:59bc
  pondering: [30, 29, 29, 31], // DS:59d0
  dismay: [21, 24, 25], // DS:59e8
  praise: [48, 46, 47], // DS:5a00
  fond: [51, 52], // DS:5a18
};
// 7a78 works on its own category order: Aces..Sixes, 4 of a Kind, Full House, Sm. Straight, Big
// Straight, Yacht, Choice
const CAT_ROW = [11, 10, 9, 8, 7, 6, 3, 4, 2, 1, 0, 5];

// Scoring as on the cards (7783:1f5d): Yacht 50; Big Straight (five in a row) 30; Sm. Straight
// (four in a row) 25; 4 of a Kind, Full House and Choice = all five dice; the faces their sum.
export function scoreOf(row, d) {
  const c = [0, 0, 0, 0, 0, 0, 0];
  for (const v of d) c[v]++;
  const sum = d.reduce((a, b) => a + b, 0);
  const counts = new Set(c.slice(1));
  let run = 0;
  for (const v of d) {
    let n = 1;
    while (v + n <= 6 && c[v + n]) n++;
    run = Math.max(run, n);
  }
  switch (row) {
    case 0: return counts.has(5) ? 50 : 0;
    case 1: return run >= 5 ? 30 : 0;
    case 2: return run >= 4 ? 25 : 0;
    case 3: return counts.has(4) || counts.has(5) ? sum : 0;
    case 4: return counts.has(3) && counts.has(2) ? sum : 0;
    case 5: return sum;
    default: { const face = 12 - row; return c[face] * face; }
  }
}
// a line worth praising (7783:1aaf)
const GOOD = [(s) => s === 50, (s) => s === 30, (s) => s === 25, (s) => s > 0, (s) => s > 0, (s) => s > 20, (s) => s > 12, (s) => s > 10, (s) => s > 8, (s) => s > 6, (s) => s > 4, (s) => s > 2];

// ---------------------------------------------------------------- Mario's planner (7a78)
// card: 12 entries in category order, null = open; dice: five values (the planner zeroes the
// dice it wants rolled again). Returns {score: category} or {reroll: true}.
export function marioPlan(card, dice, rollsLeft) {
  const d = dice;
  const count = (v) => d.filter((x) => x === v).length; // 0883
  const runFrom = (v) => { // 0857
    let n = 1;
    while (n < 6 && d.includes(v + n)) n++;
    return n;
  };
  const longest = () => Math.max(...d.map(runFrom)); // 0825
  const three = () => { // 08a4: a face showing three times or more
    for (let v = 1; v <= 6; v++) if (count(v) >= 3) return v;
    return 0;
  };
  const pairs = () => { // 0933: the first two faces showing at least twice
    let p1 = 0, p2 = 0;
    for (let v = 1; v <= 6; v++) {
      if (count(v) < 2 || v === p1 || v === p2) continue;
      if (!p1) p1 = v;
      else p2 = v;
    }
    return [p1, p2];
  };
  // 0617: what every category is worth (Full House counted as 25 here)
  const S = new Array(12).fill(0);
  for (const v of d) if (v > 0 && v < 7) S[v - 1] += v;
  const sum = d.reduce((a, b) => a + b, 0);
  let mask = 0;
  for (const v of d) mask |= 1 << count(v);
  S[11] = sum;
  if ((mask & 0xc) === 0xc) S[7] = 25;
  if (mask & 0x30) S[6] = sum;
  if (mask & 0x20) S[10] = 50;
  const lg = longest();
  if (lg >= 4) S[8] = 25;
  if (lg === 5) S[9] = 30;
  const open = (k) => card[k] === null;
  const keepOnly = (v) => d.forEach((x, i) => x !== v && (d[i] = 0)); // 0583
  const keepThree = (v) => { // 05a7
    let n = 0;
    d.forEach((x, i) => {
      if (x === v && n < 3) n++;
      else d[i] = 0;
    });
  };
  const keepTwo = (a, b) => d.forEach((x, i) => x !== a && x !== b && (d[i] = 0)); // 05d7
  let target = -1;
  const keepRun = () => { // 071a: the longest run, one of each
    let best = 0, start = 0;
    for (const v of d) {
      const n = runFrom(v);
      if (n > best) {
        best = n;
        start = v;
      }
    }
    let spare = -1;
    if (target === 9) spare = start === 1 ? 5 : start === 3 ? 2 : -1;
    let kept = false;
    d.forEach((x, i) => {
      if (x >= start && x <= start + best) return;
      if (x === spare && !kept) kept = true;
      else d[i] = 0;
    });
    for (;;) {
      const [p1, p2] = pairs();
      if (!p1 && !p2) break;
      if (p1) d[d.indexOf(p1)] = 0;
      if (p2) d[d.indexOf(p2)] = 0;
    }
  };
  const bestFace = () => { // 0430
    for (let k = 5; k >= 0; k--) if (S[k] > 0 && open(k)) return k + 1;
    return -1;
  };
  // 0146: a finished hand worth taking now
  const made = () => {
    if (S[10] > 0 && open(10)) return 10;
    if (S[9] > 0 && open(9)) return 9;
    if (S[8] > 0 && open(8) && !open(9)) return 8;
    if (S[7] > 0 && open(7) && S[7] > 9) return 7;
    if (S[6] > 0 && open(6) && !open(10) && S[6] > 8) {
      const v = three();
      if (card[v] !== null) return 6; // (sic) looks at the line after that face's own
    }
    return -1;
  };
  // 01ef: which dice to roll again; returns the category aimed at, -1 to roll everything, or
  // {score} when the dice already fill a face line completely
  const keep = () => {
    const si = three();
    if (si) {
      if (open(10)) {
        keepOnly(si);
        return 10;
      }
      if (open(6)) {
        keepOnly(si);
        return 6;
      }
      if (open(si - 1)) {
        keepOnly(si);
        return d.some((x) => x === 0) ? si - 1 : { score: si - 1 };
      }
      if (open(7)) {
        keepThree(si);
        return 7;
      }
    }
    if (longest() >= 3) {
      if (open(9)) {
        target = 9;
        keepRun();
        return 9;
      }
      if (open(8)) {
        target = 8;
        keepRun();
        return 8;
      }
    }
    let [lo, hi] = pairs();
    if (lo && hi && open(7)) {
      keepTwo(lo, hi);
      return 7;
    }
    if (lo > hi) [lo, hi] = [hi, lo];
    if (hi) {
      if (open(hi - 1)) {
        keepOnly(hi);
        return hi - 1;
      }
      if (open(7)) {
        keepOnly(hi);
        return 7;
      }
      if (open(6)) {
        keepOnly(hi);
        return 6;
      }
      const f = bestFace();
      if (f >= 4) {
        keepOnly(f);
        return f - 1;
      }
      if (open(10)) {
        keepOnly(hi);
        return 10;
      }
    }
    if (lo) {
      if (open(lo - 1)) {
        keepOnly(lo);
        return lo - 1;
      }
      if (open(7)) {
        keepOnly(lo);
        return 7;
      }
      if (open(6)) {
        keepOnly(hi);
        return 6;
      }
      if (open(10)) {
        keepOnly(hi);
        return 10;
      }
    }
    const f = bestFace();
    if (f !== -1) {
      keepOnly(f);
      return f - 1;
    }
    return -1;
  };
  // 0461: no rolls left — where to put it
  const choose = () => {
    let first = -1, lastPaying = -1, si = -1, best = -999;
    for (let k = 0; k < 12; k++) if (open(k) && first < 0) first = k;
    for (let k = 0; k < 12; k++) {
      if (!open(k)) continue;
      if (S[k] > best) {
        best = S[k];
        si = k;
      }
      if (S[k] > 0) lastPaying = k;
    }
    if (lastPaying === -1) lastPaying = first;
    const triple = () => {
      const v = three();
      return v && open(v - 1) ? v - 1 : -1;
    };
    const fallback = () => {
      let p = -1;
      for (let k = 0; k < 6; k++)
        if (open(k) && count(k + 1) === 2) {
          p = k;
          break;
        }
      if (p > 0) return p; // (sic) a pair of aces counts as none
      return lastPaying >= 3 && first < 2 ? first : lastPaying;
    };
    if (si >= 0 && si <= 5) {
      const t = triple();
      return t >= 0 ? t : fallback();
    }
    if (si === 11) {
      const t = triple();
      if (t >= 0) return t;
      return best >= 20 ? 11 : fallback();
    }
    return si;
  };
  const m = made();
  if (m !== -1) return { score: m };
  if (rollsLeft) {
    const r = keep();
    if (r === -1) {
      d.fill(0);
      return { reroll: true };
    }
    if (typeof r === "object") return r;
    return { reroll: true };
  }
  return { score: choose() };
}

class YachtIntro {
  constructor(next) {
    this.next = next;
  }
  async enter() {
    const e = this.e;
    e.setPalette(1000);
    if (e.menubar) e.menubar.visible = false;
    this.boat = e.movie(6100);
    this.boat.x = -90; // 7b14: only x is overridden
    this.wake = e.movie(6150);
    this.wake.x = -123;
    e.audio.playMusic(138, false);
    while (!this.boat.done) await e.ticks(1);
    this.go();
  }
  go() {
    if (this.gone) return;
    this.gone = true;
    if (this.e.menubar) this.e.menubar.visible = true;
    this.e.setScene(this.next);
  }
  tick() {
    this.boat.sounds();
    this.boat.advanceOnce();
    this.wake.advanceOnce();
  }
  render(s) {
    s.clear(0);
    this.e.gfx.bg(6000);
    this.boat.draw();
    this.wake.draw();
  }
  pointerUp() {
    this.go();
  }
  key() {
    this.go();
  }
}

export default class Yacht extends GameBase {
  constructor(opts = {}) {
    super();
    this.opts = opts;
  }
  enter() {
    if (!this.opts.skipIntro && !this.introDone) {
      this.introDone = true;
      return this.e.setScene(new YachtIntro(this));
    }
    return this.start();
  }
  start() {
    const e = this.e;
    this.setup({
      bg: 6001,
      talker: { base: 11000, x: 147, y: 14 },
      captionFont: 224,
      captionRect: { l: 0, t: 191, r: 320, b: 200 },
      table: TABLES.yacht,
    });
    this.sp.create(142, 54, 6012, 0, 0x19c3);
    this.card = { p: new Array(ROWS).fill(null), m: new Array(ROWS).fill(null) };
    this.dice = [0, 1, 2, 3, 4].map(() => ({ v: -1, kept: false }));
    this.cups = { m: 0, p: 0 };
    this.rolls = 0;
    this.hl = { p: -1, m: -1 };
    this.whose = null;
    this.state = "intro";
    this.round = 1;
    this.firstTurn = true;
    this.jokeNo = rnd(4);
    this.hintNow = 19; // what a tap on Mario repeats (DS:979a / 9798)
    this.hintPrev = 19;
    this.idleCount = 80;
    this.announce = 0;
    this.startOverDy = 0;
    e.run(() => this.flow());
  }
  total(w) {
    return this.card[w].reduce((a, b) => a + (b || 0), 0);
  }
  values() {
    return this.dice.map((d) => d.v);
  }

  // ---------------------------------------------------------------- start (076b)
  async flow() {
    await this.wait(1);
    await this.askNameOnce();
    await this.say(11); // "Good luck!"
    await this.waitTalk();
    this.talker.idle();
    await this.wait(6);
    await this.say(18); // "I go first."
    await this.waitTalk();
    this.talker.idle();
    await this.wait(3);
    for (;;) {
      await this.marioTurn();
      await this.playerTurn();
      if (this.round++ === 12) return this.endGame();
    }
  }

  // ---------------------------------------------------------------- dice (14fd)
  async rollDice() {
    const e = this.e;
    this.rolling = true;
    for (const d of this.dice) if (!d.kept) d.v = -1;
    const throwMv = this.playMovie(6020);
    throwMv.keep = true;
    e.audio.playSnd(5018);
    await this.movieDone(throwMv);
    for (let i = 0; i < 5; i++) {
      if (this.dice[i].kept) continue;
      await this.wait(2);
      e.audio.playSnd(5019);
      this.dice[i].v = 1 + rnd(6);
    }
    await this.wait(1);
    this.movies.splice(this.movies.indexOf(throwMv), 1);
    this.rolling = false;
  }
  clearDice() {
    for (const d of this.dice) {
      d.v = -1;
      d.kept = false;
    }
  }
  toggleKeep(i) {
    const d = this.dice[i];
    d.kept = !d.kept;
    this.e.audio.playSnd(5003);
  }

  // ---------------------------------------------------------------- Mario's turn (08d3)
  async marioTurn() {
    this.whose = "m";
    this.state = "mario";
    this.rolls = 3;
    this.sayText("");
    if (this.firstTurn) {
      await this.waitTalk();
      this.talker.idle();
    } else if (rnd(2) === 0) {
      await this.wait(3);
      this.say(20); // "It's my turn now."
      this.cups.m = this.rolls;
      await this.waitTalk();
      this.talker.idle();
    }
    this.firstTurn = false;
    for (;;) {
      this.cups.m = this.rolls;
      // Mario shakes the cup (6021, his head hidden); the dice land on its 4th frame
      this.talker.hidden = true;
      const shake = this.playMovie(6021, 97, 13);
      while (!shake.done) {
        if (shake.t === shake.step * 4) this.e.audio.playSnd(5010);
        await this.wait(1);
      }
      this.movies.splice(this.movies.indexOf(shake), 1);
      this.talker.hidden = false;
      this.talker.idle();
      this.rolls--;
      this.cups.m = this.rolls;
      await this.rollDice();
      if (!(await this.marioChooses())) break;
    }
    await this.marioScores();
    this.sayRandom(L.yourTurn);
    this.cups.m = 0;
    await this.waitTalk();
    this.talker.idle();
  }
  // 11c4: a remark, then the dice he wants again turn white one by one (and the keepers red);
  // returns true to roll again
  async marioChooses() {
    this.mScore = -1;
    if (rnd(3) < 2) await this.sayRandom(L.pondering);
    await this.waitTalk();
    this.talker.idle();
    const card = CAT_ROW.map((r) => this.card.m[r]);
    const plan = this.values();
    const r = marioPlan(card, plan, this.rolls);
    if (r.score !== undefined) {
      this.mScore = CAT_ROW[r.score];
      return false;
    }
    for (let i = 0; i < 5; i++) {
      const again = plan[i] === 0;
      if (again === !this.dice[i].kept) continue;
      this.dice[i].kept = !again;
      this.e.audio.playSnd(5028);
      await this.wait(6);
    }
    if (this.rolls && this.dice.filter((d) => !d.kept).length > 1 && rnd(4) < 1) {
      await this.say(34); // "I'm going to roll these ones again."
      await this.waitTalk();
      this.talker.idle();
      await this.wait(3);
    } else await this.wait(1);
    return true;
  }
  // 13e4 / 2787: "That's going on the" / "I'll put this on the" + the line's name + "line."
  async marioScores() {
    const row = this.mScore;
    this.announce++;
    const odd = this.announce % 2 === 1;
    const text = (odd || row === 2 ? "That's going on the " : "I'll put this on the ") + ROW_TEXT[row] + " line.";
    const t = this.talker;
    await t.sayText(odd ? 11432 : 11435, text);
    await t.sayText(TABLES.yacht[ROW_SAY[row]][1], text);
    await t.sayText(11433, text); // "line."
    t.idle();
    await this.wait(3);
    this.hl.m = row;
    this.card.m[row] = scoreOf(row, this.values());
    this.e.audio.playSnd(5003);
    await this.wait(10);
    this.hl.m = -1;
  }

  // ---------------------------------------------------------------- the player's turn (0b34)
  async playerTurn() {
    this.whose = "p";
    this.clearDice();
    this.cups.m = 0;
    this.rolls = 3;
    this.cups.p = 3;
    this.picked = -1;
    this.sayText("");
    this.hintPrev = this.hintNow = 19;
    this.idleCount = 80;
    this.state = "roll"; // waiting for the first throw (flag 0400)
    this.rollReq = false;
    for (;;) {
      while (!this.rollReq && this.picked < 0) await this.idleWait();
      if (this.picked >= 0) break;
      this.rollReq = false;
      if (this.state === "choose" && this.dice.every((d) => d.kept)) {
        this.e.run(() => this.hint(16)); // "Select the dice to roll again."
        continue;
      }
      this.state = "busy";
      this.rolls--;
      this.cups.p = this.rolls;
      await this.rollDice();
      this.idleCount = 80;
      this.state = "choose"; // flag 0020
    }
    // 0dbf: a word on the line just filled
    const row = this.picked, s = this.card.p[row];
    this.state = "busy";
    this.cups.p = 0;
    if (row === 0 && s === 50) await this.say(27); // "Hoo hoo! A Yacht!"
    else if (GOOD[row](s)) {
      if (this.total("p") > this.total("m")) await this.sayRandom(rnd(2) ? L.dismay : L.praise);
      else await this.sayRandom(L.fond);
    } else await this.say(22); // "Okay!"
    await this.waitTalk();
    this.talker.idle();
    this.clearDice();
    this.hl.p = -1;
  }
  // after 8 s without a move: a nag (0eb2) or the next knock-knock joke (1081)
  async idleWait() {
    await this.wait(1);
    if (this.talker.talking || this.busyTalk) return;
    if (--this.idleCount > 0) return;
    this.busyTalk = true;
    if (rnd(4) < 3) {
      const r = rnd(2);
      await this.say(this.rolls === 0 && this.state === "choose" ? (r ? 37 : 12) : r ? 37 : 38);
      await this.waitTalk();
      this.talker.idle();
    } else {
      this.jokeNo = (this.jokeNo + 1) % 4;
      this.jokeCut = false;
      for (const i of JOKES[this.jokeNo]) {
        if (this.jokeCut) break;
        await this.say(i);
        await this.waitTalk();
        this.talker.idle();
        await this.wait(5);
      }
      this.sayText("");
    }
    this.idleCount = 80;
    this.busyTalk = false;
  }
  // 0fcb: one hint, then back to the previous one
  async hint(i) {
    if (this.busyTalk) return;
    this.busyTalk = true;
    this.hintPrev = this.hintNow;
    this.hintNow = i;
    await this.say(i);
    await this.waitTalk();
    this.talker.idle();
    this.hintNow = this.hintPrev;
    this.idleCount = 80;
    this.busyTalk = false;
  }

  // ---------------------------------------------------------------- end (1632) / new game (18b5)
  async endGame() {
    this.state = "over";
    this.whose = null;
    this.sayText("");
    const p = this.total("p"), m = this.total("m");
    const r = rnd(2);
    if (m > p) await this.say(r ? 43 : 39);
    else if (p > m) await this.say(r ? 45 : 44);
    else await this.say(42);
    await this.waitTalk();
    this.talker.idle();
    if (p > m) {
      this.e.audio.playMusic(139, false);
      for (let i = 0; i < 5; i++) {
        this.dice[i] = { v: i + 1, kept: false };
        await this.wait(1);
      }
      this.winMv = this.playMovie(6022);
      while (this.winMv && !this.winMv.done) await this.wait(1);
      await this.wait(3);
    } else await this.wait(10);
    await this.say(53); // "Hey! Do you want to play another game?"
    await this.waitTalk();
    this.talker.idle();
    await this.wait(3);
    const again = await this.dlgPlayAgain({ noDx: 24, dy: 20 });
    if (this.winMv) this.movies.splice(this.movies.indexOf(this.winMv), 1);
    this.winMv = null;
    if (!again) return this.e.app.mainMenu(true);
    // the cards are wiped line by line
    for (let row = 0; row < ROWS; row++) {
      this.card.m[row] = this.card.p[row] = null;
      if (row % 2 === 0) this.e.audio.playSnd(5003);
      await this.wait(2);
    }
    await this.wait(10);
    this.clearDice();
    this.restart();
  }
  async newGameRequest() {
    if (this.inDialog) return;
    this.inDialog = true;
    await this.waitTalk();
    this.talker.idle();
    await this.wait(3);
    const cups = this.cups.p;
    this.cups.p = 0;
    await this.say(54); // "Are you sure you want to start another game?"
    await this.waitTalk();
    this.talker.idle();
    await this.wait(3);
    const yes = await this.dlgStartOver();
    this.inDialog = false;
    if (yes) this.restart();
    else this.cups.p = cups;
  }

  // ---------------------------------------------------------------- input (window procedure)
  rowAt(x, y) {
    if (x < 225 || x >= 305 || y < 29 || y >= 29 + 11 * ROWS) return -1;
    return ((y - 29) / 11) | 0;
  }
  dieAt(x, y) {
    for (let i = 0; i < 5; i++) if (x >= DIE_X(i) - 2 && x < DIE_X(i) + 23 && y >= 143 && y < 178) return i;
    return -1;
  }
  pointerMove(x, y) {
    this.idleCount = 80;
    // with a mouse the line under the pointer lights up while choosing
    if (this.e.pointer.type !== "mouse" || this.whose !== "p" || this.state !== "choose") return;
    const r = this.rowAt(x, y);
    this.hl.p = r >= 0 && this.card.p[r] === null ? r : -1;
  }
  pointerDown(x, y) {
    this.idleCount = 80;
    if (this.winMv) {
      this.movies.splice(this.movies.indexOf(this.winMv), 1);
      this.winMv = null;
      return;
    }
    if (this.whose !== "p") return;
    const cupsHit = x >= 240 && x < 306 && y >= 172 && y < 200;
    if (this.busyTalk) {
      this.jokeCut = true;
      if (cupsHit && this.state === "roll" && this.rolls > 0) this.rollReq = true;
      return;
    }
    const mario = (x >= 155 && x < 225 && y >= 15 && y < 110) || y >= 191;
    if (mario && (this.state === "roll" || this.state === "choose")) return void this.e.run(() => this.hint(this.hintNow));
    // the cups: (another) throw
    if (cupsHit && (this.state === "roll" || this.state === "choose") && this.rolls > 0) {
      this.rollReq = true;
      return;
    }
    if (this.state !== "choose") return;
    const i = this.dieAt(x, y);
    if (i >= 0) {
      if (this.rolls > 0) this.toggleKeep(i);
      return;
    }
    const row = this.rowAt(x, y);
    if (row < 0) return;
    if (this.card.p[row] !== null) {
      this.e.run(() => this.hint(rnd(2) ? 14 : 13)); // "You can't go there!" / "Select a different line to score."
      return;
    }
    this.hl.p = row;
    this.card.p[row] = scoreOf(row, this.values());
    this.e.audio.playSnd(5003);
    this.picked = row;
    this.state = "busy";
  }
  key(k) {
    if (k === " " || k === "Enter") this.pointerDown(262, 186);
  }

  // ---------------------------------------------------------------- tick / render
  tick() {
    if (!this.talker) return;
    this.tickCommon();
  }
  // 7783:2d41: glyph = character - 0x20, each one (the space too) advancing by its own width
  str(font, s, max, x, y) {
    const g = this.e.gfx, p = this.e.prs.pak(font);
    for (const c of s.slice(0, max)) {
      const f = p.frames[g.glyph(c.charCodeAt(0))];
      g.s.blit(f, x, y);
      x += f.x + f.w;
    }
  }
  // 2e29: the same, centred in `width` pixels as if every character were as wide as a "Q"
  strCentered(font, s, max, x, y, width) {
    const q = this.e.prs.pak(font).frames[0x31];
    this.str(font, s, max, x + Math.trunc((width - s.length * (q.x + q.w)) / 2), y);
  }
  // 2ccb: a number right-justified in width-1 characters (2 for a line, 3 for a total), drawn
  // three characters at most
  num(font, v, width, x, y) {
    const s = String(v);
    if (s.length + 1 > width) return;
    this.str(font, s.padStart(width - 1, " "), 3, x, y);
  }
  render(scr) {
    const g = this.e.gfx;
    scr.clear(0);
    g.bg(6001);
    if (!this.talker) return;
    this.strCentered(223, this.e.prefs.name || "My Friend", 11, 234, 19, 70); // 2e29
    if (this.hl.m >= 0) g.frame(6011, this.hl.m, 7, 29 + 11 * this.hl.m);
    if (this.hl.p >= 0) g.frame(6011, this.hl.p, 225, 29 + 11 * this.hl.p);
    const showPossible = this.whose === "p" && this.state === "choose" && this.dice.every((d) => d.v > 0);
    for (let r = 0; r < ROWS; r++) {
      if (this.card.m[r] !== null) this.num(223, this.card.m[r], 3, 80, 31 + 11 * r);
      if (this.card.p[r] !== null) this.num(223, this.card.p[r], 3, 298, 31 + 11 * r);
      else if (showPossible) this.num(225, scoreOf(r, this.values()), 3, 298, 31 + 11 * r);
    }
    this.num(223, this.total("m"), 4, 73, 164);
    this.num(223, this.total("p"), 4, 291, 164);
    this.talker.drawText();
    this.sp.draw();
    for (let i = 0; i < this.cups.m; i++) g.frame(6010, 13, 105 + 12 * i, 104);
    for (let i = 0; i < this.cups.p; i++) g.frame(6010, 14, 246 + 17 * i, 180);
    this.dice.forEach((d, i) => {
      if (d.v > 0) g.frame(6010, d.kept ? d.v + 5 : d.v - 1, DIE_X(i), d.kept ? 155 : 145);
    });
    this.talker.draw();
    this.drawMovies();
  }
}
