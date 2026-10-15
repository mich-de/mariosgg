// Dominoes (overlays 6d82 intro, 6840 game), ported from the original state machines: the deal
// and first move (6840:0d26 / 2b68), the player's turn (1f3b) with the pick-up-and-drop of bones
// (24a0), Mario's turn (14e4) with his choice of bone (2c38) and remarks (1ad4), the chain layout
// (306a / 335e), Mario's wandering window (4edd / 4f4d), idle chatter (1c95) and the endings
// (0f2f / 11a5 / 124b / 13b0). Bones are a back frame (Pak 3100 frame 7 horizontal / 8 vertical)
// with two 17x17 faces drawn 15 px apart (6840:2dfa); sprites glide one step per tick (3c63).
// Touch: a bone can be dropped with a second tap (as with the original's two clicks) or by
// dragging it and letting go over the field.

import { GameBase, rnd } from "./base.js";
import { TABLES } from "../data/tables.js";

const FIELD = { l: 3, t: 11, r: 317, b: 150 }; // 6840:4e7a
const CAPTION = { l: 1, t: 189, r: 317, b: 199 };
const HAND = { l: 3, t: 154, r: 277, b: 188 }; // 4da7: 16 slots of 17 px
const YARD = { l: 299, t: 155, r: 317, b: 186 }; // boneyard pile / PASS button
const SLOT_Y = 154;
const slotX = (i) => i * 17 + 3;
const WIN = { x: FIELD.l + 4, y: FIELD.t + 4 }; // Mario's window (sprite 300) starts top-left
const JOKES = [[74, 75, 78, 79, 80], [76, 77, 81, 82, 83], [74, 75, 84, 85, 86], [76, 77, 87, 88, 89]];

const pips = (b) => b[0] + b[1];
const isDouble = (b) => b[0] === b[1];
const inRect = (r, x, y) => x >= r.l && x < r.r && y >= r.t && y < r.b;
const cheb = (x0, y0, x1, y1) => Math.max(Math.abs(x0 - x1), Math.abs(y0 - y1)); // 6840:5309

// chain geometry (6840:2f10 / 47d1 / 4805): bones occupy 32x16 or 16x32 rects (orientation 4
// horizontal, 5 vertical) around their centre; the 33x17 sprites overlap their neighbours by 1 px
const CX = (FIELD.l + FIELD.r) >> 1, CY = (FIELD.t + FIELD.b) >> 1;
const boneRect = (x, y, orient) => (orient === 5 ? { l: x - 8, t: y - 16, r: x + 8, b: y + 16 } : { l: x - 16, t: y - 8, r: x + 16, b: y + 8 });
const inside = (a, b) => a.l >= b.l && a.t >= b.t && a.r <= b.r && a.b <= b.b;
const sect = (a, b) => Math.max(a.l, b.l) < Math.min(a.r, b.r) && Math.max(a.t, b.t) < Math.min(a.b, b.b);
const offsetV = (r, dv) => {
  r.t += dv;
  r.b += dv;
};

// ---------------------------------------------------------------- intro (overlay 6d82)
class DominoesIntro {
  constructor(next) {
    this.next = next;
  }
  async enter() {
    const e = this.e;
    e.setPalette(1000);
    if (e.menubar) e.menubar.visible = false;
    this.mv = e.movie(3002);
    this.mv.y = 120;
    e.audio.playMusic(134, false);
    let n = 50;
    while (n-- > 0 || !this.mv.done) await e.ticks(1);
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
    this.e.gfx.bg(3000);
    this.mv.draw();
  }
  pointerUp() {
    this.go();
  }
  key() {
    this.go();
  }
}

export default class Dominoes extends GameBase {
  constructor(opts = {}) {
    super();
    this.opts = opts;
  }
  enter() {
    if (!this.opts.skipIntro && !this.introDone) {
      this.introDone = true;
      return this.e.setScene(new DominoesIntro(this));
    }
    return this.start();
  }
  start() {
    const e = this.e;
    this.setup({
      bg: 3001,
      talker: { base: 10000, x: WIN.x + 11, y: WIN.y + 9 },
      captionFont: 224,
      captionRect: CAPTION,
      table: TABLES.dominoes,
    });
    this.sp.create(WIN.x, WIN.y, 3700, 0, 300);
    this.win = { x: WIN.x, y: WIN.y };
    this.startOverDy = -16;
    // games played since entering Dominoes (6840:0d4d), picks the praise after a win
    this.gameNo = this.opts.skipIntro ? (e.app.dominoGames || 0) + 1 : 1;
    e.app.dominoGames = this.gameNo;
    this.hand = []; // the player's bones, [low, high]
    this.mario = [];
    this.yard = this.shuffle();
    this.chain = []; // placed bones {b: [first, second] as drawn, rect, x, y, vert}
    this.ends = null; // open ends: placement records + value v
    this.held = null; // bone picked up from the hand
    this.handHidden = new Set();
    this.flying = [];
    this.dealt = false;
    this.passDown = false;
    this.turn = null;
    this.state = "intro";
    this.idleTicks = 0;
    this.idleLimit = 120;
    this.jokeNo = 0;
    this.lastPhrase = 1;
    this.lastMarioRemark = -1;
    this.lastPlayerRemark = -1;
    e.run(() => this.flow());
  }
  // the phrase on show is remembered so a tap on Mario or the caption repeats it (6840:2143)
  say(i) {
    this.lastPhrase = i;
    return super.say(i);
  }
  sayText(text) {
    this.lastPhrase = 0;
    this.dynText = text;
    return super.sayText(text);
  }
  repeatLast() {
    this.e.audio.stopSnd();
    if (this.lastPhrase === 0) return super.sayText(this.dynText || "");
    return super.say(this.lastPhrase);
  }

  // ---------------------------------------------------------------- set-up (6840:0816 / 0d26 / 2b68)
  shuffle() {
    const set = [];
    for (let a = 0; a <= 6; a++) for (let b = a; b <= 6; b++) set.push([a, b]);
    for (let pass = 0; pass < 3; pass++)
      for (let i = 0; i < 28; i++) {
        const j = rnd(28);
        [set[i], set[j]] = [set[j], set[i]];
      }
    // the deal takes the top 14 bones: make sure a doublet is among them
    if (!set.slice(14).some(isDouble)) {
      const k = set.findIndex((b, i) => i < 14 && isDouble(b));
      const j = rnd(13) + 14;
      [set[k], set[j]] = [set[j], set[k]];
    }
    return set;
  }
  async flow() {
    const e = this.e;
    await this.say(rnd(100) < 51 ? 4 : 54);
    await this.waitTalk();
    // a pair every 3 ticks, each after the previous click has finished
    for (let n = 0; n < 7; n++) {
      await this.wait(3);
      while (e.audio.playing()) await this.wait(1);
      this.hand.push(this.yard.pop());
      this.mario.push(this.yard.pop());
      this.dealt = true;
      e.audio.playSnd(5044);
    }
    while (this.talker.talking || e.audio.playing()) await this.wait(1);
    // the higher doublet starts
    const hi = (h) => h.reduce((m, b) => (isDouble(b) && b[1] > m ? b[1] : m), -1);
    const r = rnd(100);
    let turn;
    if (hi(this.hand) > hi(this.mario)) {
      turn = "player";
      this.say(r < 50 ? 6 : 8);
    } else {
      turn = "mario";
      this.say(r < 75 ? 68 : 5);
    }
    await this.waitTalk();
    await this.wait(4);
    for (;;) {
      this.turn = turn;
      const end = turn === "mario" ? await this.marioTurn() : await this.playerTurn();
      if (end) return this.endGame(end);
      turn = turn === "mario" ? "player" : "mario";
    }
  }
  // 6840:2c38 — every way a bone fits an open end; with only the first bone down, one per bone
  candidates(hand) {
    if (!this.chain.length) {
      let best = -1, i = -1;
      hand.forEach((b, k) => {
        if (isDouble(b) && b[1] > best) {
          best = b[1];
          i = k;
        }
      });
      return i < 0 ? [] : [{ i, side: "R", other: hand[i][0] }];
    }
    const out = [];
    const L = this.ends.L.v, R = this.ends.R.v, single = this.chain.length === 1;
    hand.forEach(([a, b], i) => {
      if (a === L) {
        out.push({ i, side: "L", other: b });
        if (single) return;
      }
      if (b === L && a !== b) {
        out.push({ i, side: "L", other: a });
        if (single) return;
      }
      if (a === R) {
        out.push({ i, side: "R", other: b });
        if (single) return;
      }
      if (b === R && a !== b) out.push({ i, side: "R", other: a });
    });
    return out;
  }

  // ---------------------------------------------------------------- Mario's turn (6840:14e4)
  async marioTurn() {
    this.state = "mario";
    await this.waitTalk();
    await this.checkWindow();
    if (rnd(100) < 70) this.sayText("It's my turn");
    else this.say(10);
    let draws = 0;
    this.thought = false;
    for (;;) {
      await this.waitTalk();
      this.marioPassed = false;
      let idx = -1;
      if (!this.chain.length) {
        // opening: his highest doublet
        let best = -1;
        idx = 0;
        this.mario.forEach((b, i) => {
          if (isDouble(b) && b[1] > best) {
            best = b[1];
            idx = i;
          }
        });
      } else {
        const cands = this.candidates(this.mario);
        await this.marioRemark(cands.length, draws);
        // the bone that leaves the lowest number open (first found on ties)
        if (cands.length) idx = cands.reduce((m, c) => (c.other < m.other ? c : m)).i;
      }
      if (idx >= 0) {
        await this.marioPlays(idx);
        return this.mario.length ? null : "mario";
      }
      if (this.yard.length) {
        draws++;
        this.mario.push(this.yard.pop());
        if (!this.yard.length && !this.talker.talking) this.say(64); // no more in the boneyard
        continue;
      }
      const q = rnd(100);
      this.say(q < 50 ? 34 : q < 70 ? 33 : q < 80 ? 32 : 35);
      this.marioPassed = true;
      return this.playerPassed ? "blocked" : null;
    }
  }
  // 6840:1ad4 — a "Hmm..." now and then, then a remark before every move (never the same twice
  // running); when stuck, a comment on the first draw and a click on the next ones
  async marioRemark(found, draws) {
    for (;;) {
      await this.waitTalk();
      const dx = rnd(11);
      if (!this.thought && this.mario.length > 3 && dx < 6) {
        this.thought = true;
        const n = rnd(5) + 3;
        this.say(22);
        await this.waitTalk();
        await this.wait(n + 1);
        continue;
      }
      let si = -1;
      if (!found) {
        this.lastMarioRemark = -99;
        if (!this.yard.length) return;
        if (draws > 0) {
          this.e.audio.playSnd(5003);
          return;
        }
        si = dx < 4 ? 69 : dx < 7 ? 31 : 14;
      } else if (this.mario.length > 6 && this.hand.length < 3) si = dx === 1 ? 25 : dx === 2 ? 26 : dx === 3 ? 15 : dx === 4 ? 28 : -1;
      else si = dx < 2 ? 21 : dx < 4 ? 20 : dx < 6 ? 23 : dx < 7 ? 24 : dx < 8 ? 67 : -1;
      if ((found && si === -1) || (si !== -1 && si === this.lastMarioRemark)) {
        await this.wait(1);
        continue;
      }
      if (si === -1) return;
      this.lastMarioRemark = si;
      this.say(si);
      return;
    }
  }
  // 6840:16fe..1a4c — pick the end (a coin toss when the bone fits both), then the bone glides
  // from Mario's window to its place
  async marioPlays(idx) {
    const b = this.mario[idx];
    let side = null;
    if (this.chain.length) {
      const L = this.ends.L.v, R = this.ends.R.v, [a, c] = b;
      const coin = () => (rnd(2) ? "R" : "L");
      if (a === c) side = c === L && c === R ? coin() : c === L ? "L" : "R";
      else if ((a === L || a === R) && (c === L || c === R)) side = coin();
      else side = a === L || c === L ? "L" : "R";
    }
    await this.waitTalk();
    if (!this.e.audio.playing()) this.e.audio.playSnd(5043);
    const entry = this.place(b, side);
    entry.hidden = true;
    const wr = this.winRect();
    const cx = wr.l + ((wr.r - wr.l) >> 1), cy = wr.t + ((wr.b - wr.t) >> 1);
    const w = (entry.vert ? 16 : 32) + 1, h = (entry.vert ? 32 : 16) + 1;
    let x = entry.x > cx ? wr.r + 1 : wr.l - w;
    if (x < FIELD.l) x = FIELD.l;
    else if (FIELD.r - w < x) x = FIELD.r - w;
    let y = cy;
    if (entry.y > cy) {
      if (FIELD.b - wr.b > h) y = wr.b + 1;
    } else if (wr.t - FIELD.t > h) y = wr.t - h;
    this.mario.splice(idx, 1);
    await this.fly(entry.b, entry.vert, x, y, entry.x, entry.y, cheb(x, y, entry.x, entry.y) > 120 ? 15 : 11);
    entry.hidden = false;
    this.e.audio.playSnd(5017);
    await this.waitTalk();
    await this.checkWindow();
  }

  // ---------------------------------------------------------------- the player's turn (6840:1f3b)
  async playerTurn() {
    this.drew = false;
    for (;;) {
      this.state = "busy";
      await this.waitTalk();
      await this.checkWindow();
      const r = rnd(500);
      if (!this.drew && r < 45) this.say(r < 15 ? 8 : r < 30 ? 9 : 11);
      else this.sayText("It's your turn.");
      const t = await this.nextTap();
      this.playerPassed = false;
      if (inRect(this.winRect(), t.x, t.y) || inRect(CAPTION, t.x, t.y)) {
        this.repeatLast();
        continue;
      }
      if (inRect(FIELD, t.x, t.y)) continue;
      if (inRect(HAND, t.x, t.y)) {
        if ((await this.moveBone(t)) !== "placed") continue;
        await this.waitTalk();
        await this.checkWindow();
        return this.hand.length ? null : "player";
      }
      if (inRect(YARD, t.x, t.y) && (await this.boneyard()) === "passed") {
        await this.waitTalk();
        await this.checkWindow();
        return this.marioPassed ? "blocked" : null;
      }
    }
  }
  // 6840:24a0 — pick a bone up (it follows the pointer), put it down near an open end
  async moveBone(t) {
    const i = Math.floor((t.x - HAND.l) / 17);
    if (i < 0 || i >= this.hand.length) return;
    const b = this.hand[i];
    const held = { i, b, x: slotX(i), y: SLOT_Y, ox: t.x - slotX(i), oy: t.y - SLOT_Y };
    this.held = held;
    if (!this.talker.talking) this.e.audio.playSnd(5043);
    const up = await this.nextRelease();
    const drop = cheb(up.x, up.y, t.x, t.y) > 6 && inRect(FIELD, up.x, up.y) ? up : await this.nextTap();
    held.x = drop.x - held.ox;
    held.y = drop.y - held.oy;
    this.state = "busy";
    const side = inRect(FIELD, drop.x, drop.y) ? this.dropSide(b, drop.x, drop.y) : null;
    if (side && this.candidates(this.hand).some((c) => c.i === i && (c.side === side || this.chain.length < 2))) {
      this.e.audio.playSnd(5017);
      this.held = null;
      this.hand.splice(i, 1);
      this.place(b, this.chain.length ? side : null);
      await this.slideHand(i);
      await this.playerRemark();
      return "placed";
    }
    // back into the hand
    this.e.audio.playSnd(5042);
    this.held = null;
    this.handHidden.add(i);
    if (held.x !== slotX(i) || held.y !== SLOT_Y) await this.fly([b[1], b[0]], true, held.x, held.y, slotX(i), SLOT_Y, 30);
    this.handHidden.delete(i);
    this.e.audio.playSnd(5017);
  }
  // which end a drop at (x,y) means: the nearer one within 70 px — less when the two ends have
  // come close together, and then the numbers on the bone decide (6840:261d..2788)
  dropSide(b, x, y) {
    const L = this.ends ? this.ends.L : { x: CX, y: CY }, R = this.ends ? this.ends.R : { x: CX, y: CY };
    let lim = 70, dEnds = Infinity;
    if (this.chain.length > 6) {
      dEnds = cheb(R.x, R.y, L.x, L.y);
      if (dEnds < lim) lim = dEnds >> 1;
      if (lim < 32) lim = 32;
    }
    const dl = cheb(x, y, L.x, L.y), dr = cheb(x, y, R.x, R.y);
    let side = null;
    if (dl < dr) {
      if (dl < lim) side = "L";
    } else if (dr < lim) side = "R";
    if (side && dEnds < 32) {
      if (b[0] === L.v || b[1] === L.v) side = "L";
      else if (b[0] === R.v || b[1] === R.v) side = "R";
    }
    return side;
  }
  async slideHand(from) {
    const moves = [];
    for (let k = from; k < this.hand.length; k++) {
      this.handHidden.add(k);
      const hb = this.hand[k];
      moves.push(this.fly([hb[1], hb[0]], true, slotX(k + 1), SLOT_Y, slotX(k), SLOT_Y, 4));
    }
    await Promise.all(moves);
    this.handHidden.clear();
  }
  // 6840:2a7c — now and then a word on the player's move
  async playerRemark() {
    for (;;) {
      await this.waitTalk();
      if (this.playerPassed || !this.hand.length) return;
      const dx = rnd(11);
      let si;
      if (this.hand.length < 3 && dx < 5) si = dx < 2 ? 17 : dx < 4 ? 12 : 13;
      else si = dx < 2 ? 58 : dx === 2 ? 55 : dx === 3 ? 52 : dx === 4 ? 12 : -1;
      if (si !== -1 && si === this.lastPlayerRemark) {
        await this.wait(1);
        continue;
      }
      if (si === -1) return;
      this.lastPlayerRemark = si;
      this.say(si);
      return;
    }
  }
  // 6840:217f — draw a bone (it glides from the pile to the next slot), or PASS once it is empty
  async boneyard() {
    const e = this.e;
    if (this.yard.length) {
      if (this.hand.length >= 16) return void e.audio.playSnd(9202);
      e.audio.playSnd(5003);
      this.say(!this.drew && rnd(100) > 30 ? 66 : 1); // "Here's your bone."
      this.drew = true;
      const b = this.yard.pop();
      const k = this.hand.length;
      const glide = this.fly([b[1], b[0]], true, YARD.r - 16, YARD.b - 32, slotX(k), SLOT_Y, 35);
      e.audio.playSnd(5042);
      await glide;
      this.hand.push(b);
      if (!this.yard.length) {
        await this.waitTalk();
        this.say(64); // "Oh-oh, no more dominoes in the Boneyard."
      }
      return;
    }
    e.audio.playSnd(5024);
    this.sayText("Pass.");
    this.passDown = true;
    this.playerPassed = true;
    await this.wait(2);
    const up = await this.nextRelease();
    this.passDown = false;
    return inRect(YARD, up.x, up.y) ? "passed" : undefined;
  }

  // ---------------------------------------------------------------- input
  nextTap() {
    this.state = this.held ? "held" : "player";
    return new Promise((res) => (this.tapWaiter = res));
  }
  nextRelease() {
    if (!this.e.pointer.down) return Promise.resolve(this.lastUp || { x: -1, y: -1 });
    return new Promise((res) => (this.upWaiter = res));
  }
  pointerDown(x, y) {
    this.idleTicks = 0;
    if (this.idleSeq) return; // Mario has the floor (6840:1f5e)
    const w = this.tapWaiter;
    if (w) {
      this.tapWaiter = null;
      w({ x, y });
    }
  }
  pointerMove(x, y) {
    this.idleTicks = 0;
    const h = this.held;
    if (h && (this.e.pointer.down || this.e.pointer.type === "mouse")) {
      h.x = x - h.ox;
      h.y = y - h.oy;
    }
  }
  pointerUp(x, y) {
    this.lastUp = { x, y };
    const w = this.upWaiter;
    if (w) {
      this.upWaiter = null;
      w({ x, y });
    }
  }
  // 3c63:018c — a bone gliding in a straight line, one step per tick
  fly(b, vert, x0, y0, x1, y1, n) {
    return new Promise((done) => this.flying.push({ b, vert, x0, y0, x1, y1, n, t: 0, x: x0, y: y0, done }));
  }

  // ---------------------------------------------------------------- chain layout (6840:306a)
  // Port of the original placement state machine (6840:335e). Each open end keeps a record of
  // its last bone: rect, the four attachment points (left/right/top/bottom edge, the top and
  // bottom ones shifted 8 px towards the leading half) and the direction it is growing in
  // (0 left, 1 right, 2 up, 3 down). The left end runs left along the middle row, turns down
  // at the edge, comes back along the bottom in a wave and finally climbs the right side; the
  // right end does the mirror image across the top. Quirks of the original are kept on purpose.
  place(b, side) {
    if (!this.ends) {
      // first bone: horizontal, 4 px below the field centre (even a doublet)
      const rect = boneRect(CX, CY + 4, 4);
      const rec = { rect, x: CX, y: CY + 4, orient: 4, lx: rect.l, ly: CY + 4, rx: rect.r, ry: CY + 4, tx: CX, ty: rect.t, bx: CX, by: rect.b };
      this.ends = { L: { ...rec, x: rect.l, dir: 0, v: b[0], n: 1 }, R: { ...rec, x: rect.r, dir: 1, v: b[1], n: 1 } };
      this.lay = { L: { state: 0, sub: 0, dbl: 0 }, R: { state: 0, sub: 0, dbl: 0 } };
      const first = { b: [b[0], b[1]], rect, x: rect.l, y: rect.t, vert: false };
      this.chain.push(first);
      return first;
    }
    const end = this.ends[side];
    const touch = b[0] === end.v ? b[0] : b[1];
    const other = b[0] === end.v ? b[1] : b[0];
    const r = this.nextPos(side, isDouble(b));
    // the half that matches faces back towards the chain
    const back = r.orient === 4 ? r.dir === 0 : r.dir === 2;
    const entry = { b: back ? [other, touch] : [touch, other], rect: r.rect, x: r.rect.l, y: r.rect.t, vert: r.orient === 5 };
    this.chain.push(entry);
    Object.assign(end, r, { v: other, n: end.n + 1 });
    return entry;
  }
  // 6840:4841 — candidate spot `mode` next to end record p, inside `area`, not overlapping the
  // chain. Fills `out` even when the spot is rejected (the caller sometimes keeps it anyway).
  tryMode(out, mode, w, h, dbl, area, p) {
    let dir, orient, x, y;
    if (mode <= 5) { dir = 0; orient = 4; }
    else if (mode <= 11) { dir = 1; orient = 4; }
    else if (mode <= 16) { dir = 2; orient = 5; }
    else { dir = 3; orient = 5; }
    const h2 = h >> 1, w2 = w >> 1, w4 = w >> 2;
    switch (mode) {
      case 0: if (dbl) orient = 5; x = p.lx - h2; y = p.ly; break;
      case 1: x = p.lx - ((h * 3) >> 2); y = p.ty - w2; break;
      case 2: x = p.lx; y = p.ty - w2; break;
      case 3: x = p.lx - (h >> 2); y = p.by + w2; break;
      case 4: x = p.lx; y = p.by + w2; break;
      case 5: x = p.tx - h2; y = p.ty - w2; break;
      case 6: if (dbl) orient = 5; x = p.rx + h2; y = p.ry; break;
      case 7: x = p.rx + ((h * 3) >> 2); y = p.ty - w2; break;
      case 8: x = p.rx; y = p.ty - w2; break;
      case 9: x = p.rx + (h >> 2); y = p.by + w2; break;
      case 10: x = p.rx; y = p.by + w2; break;
      case 11: x = p.lx + h2; y = p.ty + w2; break;
      case 12: if (dbl) orient = 4; x = p.tx; y = p.ty - w2; break;
      case 13: x = p.lx - h2; y = p.ty - w4; break;
      case 14: x = p.lx - h2; y = p.ty; break;
      case 15: x = p.rx + h2; y = p.ty - w4; break;
      case 16: x = p.rx + h2; y = p.ty; break;
      case 17: if (dbl) orient = 4; x = p.bx; y = p.by + w2; break;
      case 18: x = p.lx - h2; y = p.by + w4; break;
      case 19: x = p.lx - h2; y = p.by; break;
      case 20: x = p.rx + h2; y = p.by + w4; break;
      case 21: x = p.rx + h2; y = p.by; break;
    }
    const rect = boneRect(x, y, orient);
    if (dbl && !inside(rect, area)) {
      // pushed back into the area — vertically even for the left/right overflow (sic)
      if (rect.t < area.t) offsetV(rect, area.t - rect.t);
      if (rect.b > area.b) offsetV(rect, area.b - rect.b);
      if (rect.l < area.l) offsetV(rect, area.l - rect.l);
      if (rect.r > area.r) offsetV(rect, area.r - rect.r);
    }
    Object.assign(out, { dir, orient, x, y, rect, tried: true });
    return inside(rect, area) && !this.chain.some((c) => sect(rect, c.rect));
  }
  // 6840:335e
  nextPos(side, dbl) {
    const left = side === "L";
    const st = this.lay[side];
    const p = { ...this.ends[side] };
    if (this.ends[side].n < 2) {
      st.state = 0;
      st.dbl = 0;
    }
    const out = { rect: { l: 0, t: 0, r: 0, b: 0 }, tried: false };
    const shift = (dx, dy) => {
      out.rect.l += dx; out.rect.r += dx; out.x += dx;
      out.rect.t += dy; out.rect.b += dy; out.y += dy;
    };
    const F = FIELD;
    let ok = false;
    for (let attempt = 1; !ok && attempt <= 7; attempt++) {
      const a = { l: F.l, t: F.t, r: F.r, b: F.b + 7 };
      const T = (mode, w, h, d = 0) => this.tryMode(out, mode, w, h, d, a, p);
      if (left) {
        switch (st.state) {
          case 0: {
            if (st.dbl > 0) dbl = false;
            a.l += 17;
            if (T(0, dbl ? 32 : 16, dbl ? 16 : 32, dbl)) {
              ok = true;
              if (dbl) st.dbl++;
            } else if (T(19, 32, 16)) ok = true;
            else st.state = 1;
            break;
          }
          case 1:
            a.l += 17; a.b -= 17;
            if (T(17, 32, 16)) ok = true;
            else if (T(20, 32, 16)) { shift(0, 1); ok = true; }
            else if (p.orient === 5 && T(21, 32, 16)) ok = true;
            else { st.sub = 1; st.state = 2; }
            break;
          case 2:
            a.l += 17; a.b -= 17;
            if (st.sub === 0) {
              if (F.r - 64 >= p.rx && (T(20, 32, 16) || T(21, 32, 16))) ok = true;
              st.sub = 1;
            } else if (st.sub === 1) {
              ok = T(6, 16, 32);
              st.sub = 2;
            } else if (st.sub === 2) {
              if (F.r - 64 < p.rx) st.sub = 1;
              else {
                ok = T(16, 32, 16) || T(6, 32, 16);
                st.sub = 3;
              }
            } else {
              ok = T(6, 16, 32);
              st.sub = 0;
            }
            if (out.tried && F.r - 16 < out.rect.r) { st.state = 3; ok = false; }
            break;
          case 3:
            ok = T(6, 16, 32) || T(7, 16, 32) || T(8, 16, 32) || T(12, 32, 16) || T(5, 16, 32);
            if (!ok && a.t + 32 >= p.ty && a.t + 8 <= p.ty) {
              Object.assign(out, { x: p.tx, y: a.t + 16, dir: 2, orient: 5, rect: boneRect(p.tx, a.t + 16, 5) });
              ok = true;
              st.state = 4;
            }
            if (!ok) {
              if (T(0, 16, 32)) { st.state = 4; ok = true; }
              else if (T(15, 32, 16) || T(16, 32, 16) || T(14, 32, 16)) ok = true;
              else st.state = 4;
            }
            if (ok && out.orient === 4) {
              let d = F.r - out.rect.r;
              if (d > 2 && d < 32) shift(2, 0);
              d = out.rect.t - F.t;
              if (d > 0 && d < 8) shift(0, -d);
            }
            if (ok && out.orient === 5) {
              const d = out.rect.t - F.t;
              if (d >= 18 && d < 32) shift(0, -2);
            }
            break;
          case 4: {
            T(12, 32, 16) || T(13, 32, 16) || T(14, 32, 16) || T(0, 16, 32);
            ok = true; // keeps the last spot even if it overlaps
            const d = out.rect.l - F.l;
            if (d > 2 && d < 32) shift(-2, 0);
            break;
          }
          default: {
            T(0, 16, 32) || T(3, 16, 32) || T(4, 16, 32) || T(17, 32, 16) || T(18, 32, 16) || T(20, 32, 16) || T(19, 32, 16) || T(21, 32, 16) || T(6, 32, 16);
            ok = true;
            const d = out.rect.l - F.l;
            if (out.orient === 4 && d > 2 && d < 32) shift(-2, 0);
          }
        }
      } else {
        switch (st.state) {
          case 0: {
            if (st.dbl > 0) dbl = false;
            a.r -= 17;
            if (T(6, dbl ? 32 : 16, dbl ? 16 : 32, dbl)) {
              ok = true;
              if (dbl) st.dbl++;
            } else {
              ok = T(16, 32, 16);
              st.state = 1;
            }
            break;
          }
          case 1:
            a.r -= 17; a.t += 17;
            if (T(12, 32, 16)) ok = true;
            else if (T(13, 32, 16)) { shift(0, -1); ok = true; }
            else if (T(14, 32, 16)) ok = true;
            else { st.sub = 1; st.state = 2; }
            break;
          case 2:
            a.r -= 17; a.t += 17;
            if (st.sub === 0) {
              if (F.l + 64 <= p.lx && (T(12, 32, 16) || T(13, 32, 16) || T(14, 32, 16))) ok = true;
              st.sub = 1;
            } else if (st.sub === 1) {
              ok = T(0, 16, 32);
              st.sub = 3;
            } else if (st.sub === 2) {
              ok = T(0, 16, 32);
              st.sub = 0;
            } else {
              if (F.l + 64 > p.lx) st.sub = 1;
              else {
                ok = T(19, 32, 16);
                st.sub = 2;
              }
            }
            if (out.tried && F.l + 16 > out.rect.l) { st.state = 3; ok = false; }
            break;
          case 3:
            ok = T(0, 16, 32) || T(3, 16, 32) || T(4, 16, 32) || T(17, 32, 16) || T(11, 16, 32);
            if (!ok && a.b - 32 <= p.by && a.b - 8 >= p.by) {
              Object.assign(out, { x: p.bx, y: a.b - 16, dir: 3, orient: 5, rect: boneRect(p.bx, a.b - 16, 5) });
              ok = true;
              st.state = 4;
            }
            if (!ok) {
              if (T(6, 16, 32)) { st.state = 4; ok = true; }
              else if (T(19, 32, 16) || T(21, 32, 16)) ok = true;
              else st.state = 4;
            }
            if (ok && out.orient === 4) {
              let d = out.rect.l - F.r; // (sic) never in range
              if (d > 2 && d < 32) shift(-2, 0);
              d = F.b - out.rect.b;
              if (d > 0 && d < 8) shift(0, d - 1);
            }
            if (ok && out.orient === 5) {
              const d = F.b - out.rect.l; // (sic)
              if (d > 2 && d < 32) shift(0, 2);
            }
            break;
          case 4: {
            T(17, 32, 16) || T(20, 32, 16) || T(21, 32, 16) || T(6, 16, 32);
            ok = true;
            if (out.orient === 4) {
              const d = F.r - out.rect.r;
              if (d > 2 && d < 32) shift(2, 0);
            }
            if (out.orient === 5) {
              const d = F.b - out.rect.b;
              if (d > 2 && d < 32) shift(0, 2);
            }
            break;
          }
          default: {
            T(6, 16, 32) || T(7, 16, 32) || T(8, 16, 32) || T(15, 32, 16) || T(12, 32, 16);
            ok = true;
            const d = F.r - out.rect.r;
            if (d > 2 && d < 32) shift(2, 0);
          }
        }
      }
    }
    // new end record (6840:46cf)
    const { rect, x, y, dir, orient } = out;
    const rec = { rect: { ...rect }, x, y, dir, orient, lx: rect.l, rx: rect.r, ty: rect.t, by: rect.b };
    if (dir <= 1 && orient === 4) {
      rec.ly = rec.ry = y;
      rec.tx = rec.bx = x + (dir === 0 ? -8 : 8);
    } else if (dir >= 2 && orient === 5) {
      rec.ly = rec.ry = y + (dir === 2 ? -8 : 8);
      rec.tx = rec.bx = x;
    } else {
      rec.ly = rec.ry = y;
      rec.tx = rec.bx = x;
    }
    return rec;
  }

  // ---------------------------------------------------------------- Mario's window (6840:4edd)
  // Once Mario stops talking, his window jumps away (sound 5023) when an open end of the chain
  // comes within 41 px of its centre (Chebyshev distance, 6840:5309). Spots tried in order: the
  // four corners of the field, its centre, top centre, bottom centre (6840:4f4d).
  winRect() {
    const f = this.e.gfx.frameInfo(3700, 0);
    const l = this.win.x + f.x, t = this.win.y + f.y;
    return { l, t, r: l + f.w, b: t + f.h };
  }
  async checkWindow() {
    await this.waitTalk();
    if (!this.ends) return;
    const r = this.winRect();
    const cx = r.l + ((r.r - r.l) >> 1), cy = r.t + ((r.b - r.t) >> 1);
    if (this.farFromEnds(cx, cy)) return;
    this.moveWindow(false);
    this.e.audio.playSnd(5023);
  }
  farFromEnds(x, y) {
    const d = (e) => Math.max(Math.abs(x - e.x), Math.abs(y - e.y));
    return !this.ends || (d(this.ends.L) > 41 && d(this.ends.R) > 41);
  }
  moveWindow(centre) {
    const r = this.winRect();
    const hw = (r.r - r.l) >> 1, hh = (r.b - r.t) >> 1;
    const F = FIELD;
    let c;
    if (centre) c = [CX, CY];
    else {
      const spots = [
        [hw + F.l + 4, hh + F.t + 4], [hw + F.l + 4, F.b - (hh + 4)], [F.r - (hw + 4), F.b - (hh + 4)],
        [F.r - (hw + 4), hh + F.t + 4], [CX, CY], [CX, hh + F.t + 4], [CX, F.b - (hh + 4)],
      ];
      c = spots.find(([x, y]) => this.farFromEnds(x, y)) || [CX - hw, CY - hh]; // (sic) off by half a window
    }
    const x = c[0] - hw - (r.l - this.win.x), y = c[1] - hh - (r.t - this.win.y);
    this.win = { x, y };
    this.sp.set(300, { x, y });
    const t = this.talker;
    t.x = t.mv.x = x + 11;
    t.y = t.mv.y = y + 9;
  }
  // ---------------------------------------------------------------- end of game
  // 6840:0b47..0c52: the blocked count (0f2f), Mario's win (11a5), the player's win (124b, then
  // 13b0: window to the centre, music 135 and movie 3900), then "another game?".
  async endGame(how) {
    this.state = "over";
    this.turn = null;
    await this.waitTalk();
    let winner = how;
    const r = rnd(100);
    if (how === "blocked") {
      await this.say(r < 50 ? 29 : 30); // "We're both blocked." / "We can't move."
      await this.waitTalk();
      await this.wait(15);
      await this.say(48); // "Let's count them, and see who won!"
      await this.waitTalk();
      await this.wait(15);
      const mp = this.mario.reduce((s, b) => s + pips(b), 0);
      const pp = this.hand.reduce((s, b) => s + pips(b), 0);
      winner = pp < mp ? "player" : pp > mp ? "mario" : "tie";
      this.sayText(`I have ${mp || "no"} points, and you have ${pp || "no points"}`);
      const snd = this.e.audio.playSnd(winner === "mario" ? 5034 : 5057);
      await this.wait(30);
      await snd;
      const q = rnd(100);
      if (winner === "mario") await this.say(q < 40 ? 49 : q < 80 ? 45 : 46);
      else if (winner === "player") await this.say(q < 40 ? 50 : q < 80 ? 42 : 44);
      else await this.say(51);
      await this.waitTalk();
      await this.wait(15);
    } else if (how === "mario") {
      await this.say(r < 40 ? 47 : r < 80 ? 45 : 46);
      await this.waitTalk();
      await this.wait(10);
    } else {
      await this.wait(10);
      await this.say(r < 20 ? 40 : r < 40 ? 71 : r < 60 ? 44 : r < 80 ? 42 : r < 90 ? 70 : 41);
      await this.waitTalk();
      await this.wait(5);
      const q = rnd(100);
      if (this.gameNo === 1) await this.say(q < 30 ? 52 : q < 50 ? 54 : q < 80 ? 55 : 58);
      else await this.say(q < 30 ? 53 : q < 50 ? 56 : q < 80 ? 57 : 59);
      await this.waitTalk();
      await this.wait(5);
    }
    if (winner === "player") {
      this.moveWindow(true);
      await this.e.audio.playSnd(5023);
      this.e.audio.playMusic(135, false);
      const m = this.playMovie(3900, this.win.x - 9, this.win.y);
      await this.movieDone(m);
      while (this.e.audio.musicPlaying()) await this.wait(1);
      await this.wait(3);
    }
    if (this.e.audio.soundOn) {
      await this.say(rnd(10) < 5 ? 61 : 60); // another game?
      await this.waitTalk();
      await this.wait(1);
    }
    const again = await this.dlgPlayAgain({ dy: -24 });
    if (again) this.restart();
    else this.e.app.mainMenu(true);
  }

  // ---------------------------------------------------------------- tick / idle (6840:1c95)
  tick() {
    if (!this.talker) return;
    this.tickCommon();
    for (const f of [...this.flying]) {
      f.t++;
      f.x = Math.round(f.x0 + ((f.x1 - f.x0) * f.t) / f.n);
      f.y = Math.round(f.y0 + ((f.y1 - f.y0) * f.t) / f.n);
      if (f.t >= f.n) {
        this.flying.splice(this.flying.indexOf(f), 1);
        f.done();
      }
    }
    // idle chatter while the player thinks: 30% "what's taking so long?", 20% "still want to
    // play?", else the next knock-knock joke; then 6..31 s until the next one
    if (this.turn !== "player" || this.talker.talking || this.idleSeq) return;
    if (++this.idleTicks < this.idleLimit) return;
    this.idleSeq = true;
    this.e.run(async () => {
      const r = rnd(100);
      if (r < 30) await this.say(72);
      else if (r < 50) await this.say(73);
      else {
        this.jokeNo = (this.jokeNo + 1) % 4;
        const lines = JOKES[this.jokeNo];
        for (let k = 0; k < lines.length; k++) {
          await this.say(lines[k]);
          await this.waitTalk();
          if (k < lines.length - 1) await this.wait(5);
        }
      }
      await this.waitTalk();
      this.idleSeq = false;
      this.idleTicks = 0;
      this.idleLimit = 60 + rnd(250);
    });
  }

  // ---------------------------------------------------------------- render
  drawBone(b, x, y, vert) {
    const g = this.e.gfx;
    g.frame(3100, vert ? 8 : 7, x, y);
    g.frame(3100, b[0], x, y);
    if (vert) g.frame(3100, b[1], x, y + 15);
    else g.frame(3100, b[1], x + 15, y);
  }
  render(scr) {
    const g = this.e.gfx;
    scr.clear(0);
    g.bg(3001);
    if (!this.talker) return;
    // the pile and its count, or PASS once it is empty
    if (this.yard.length) {
      g.frame(3100, 9, YARD.l, YARD.t);
      g.frame(3010, this.yard.length, 301, 173);
    } else g.frame(3100, this.passDown ? 11 : 10, YARD.l, YARD.t);
    for (const c of this.chain) if (!c.hidden) this.drawBone(c.b, c.x, c.y, c.vert);
    this.sp.draw();
    this.talker.draw();
    if (this.dealt) g.frame(3701, Math.min(28, this.mario.length), this.win.x + 32, this.win.y + 45);
    this.hand.forEach((b, i) => {
      if (!this.handHidden.has(i) && !(this.held && this.held.i === i)) this.drawBone([b[1], b[0]], slotX(i), SLOT_Y, true);
    });
    if (this.held) this.drawBone([this.held.b[1], this.held.b[0]], this.held.x, this.held.y, true);
    for (const f of this.flying) this.drawBone(f.b, f.x, f.y, f.vert);
    this.talker.drawText();
    this.drawMovies();
  }
}
