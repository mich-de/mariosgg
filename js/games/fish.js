// Go Fish (overlays 6f3e intro, 7000 game, 6ea7 card logic), ported routine by routine from the
// original's tick-driven state machines: every routine keeps its own state counter and runs once
// per ~9.1 Hz tick in the order of the tick handler 7000:03b2. Quirks of the original are kept and
// marked (sic); the places where it would hang are marked (fix).
//
// Rules as the original plays them: 7 cards each, Mario always goes first. Asking for a rank
// Mario holds takes all his cards of it and the player goes again; otherwise "Go fish!" and the
// player draws, going again only when the drawn card is the rank asked for. Four of a kind make
// a book, but a book is only laid down after receiving cards. The game ends as soon as somebody
// has to fish from an empty deck (or the player has no cards and the deck is empty); whoever
// has more books wins.

import { GameBase, rnd, bagPick } from "./base.js";
import { TABLES } from "../data/tables.js";

const NONE = 99; // empty hand slot in 6ea7's arrays
const CARDS = 5005, PIECES = 5006, ICONS = 5007, YOU_WIN = 5008, HILIT = 5009, WIN_CARDS = 5211;

// The player's hand: 13 slots, one rank each with a count badge. Slot i sits in column
// SLOT_COL[i] (0x39ee), filling from the centre outwards: 7 on the bottom row, 6 above (327b).
const SLOT_COL = [3, 4, 2, 5, 1, 6, 0, 10, 9, 11, 8, 12, 7];
const COL_SLOT = [6, 4, 2, 0, 1, 3, 5, 12, 10, 8, 7, 9, 11]; // 0x3a08
const PILE = 13; // hit-list entry 0x16a8: Pak 5006 frame 6 at (200,90) (37cd)
const PILE_RECT = { l: 200, t: 90, r: 259, b: 104 };
const PILE_TOUCH = { l: 196, t: 82, r: 263, b: 112 }; // a little larger for fingers

// sprite ids of the original (the drawn card really is 0x16bc too, a second sprite with the id of
// Mario's turn frame; 1919 allows duplicates and deletes the newest, which a distinct id mimics)
const ID = {
  body: 0x14b4, boxM: 0x16bc, boxP: 0x16c6, drawn: 0x116bc, held: 0x16bd, held2: 0x1997, held3: 0x19c9,
  askIcon: 0x172d, youWin: 0x172a, win: 0x1720,
  face: 0x157c, back1: 0x15ae, back2: 0x15e0, badge1: 0x1612, badge2: 0x1644, badge3: 0x1676, badge4: 0x16a8,
  hilit: 0x170c,
};

// phrase lists (DGROUP {count, index, items}); picks go through 36b6:0004's shuffle bag
const L_GREET = [78, 79, 80, 26];
const L_PRAISE = [81, 82, 83];
const L_MARIO_FISH = [51, 55, 54];
const L_MARIO_WINS = [69, 68, 65, 66];
const L_YOU_WIN = [70];
const L_MARIO_GOT = [58, 50, 77];
const L_YOU_GOT = [39, 40];
const L_IDLE = [61, 62];
const L_OH_NO = [84, 85];
const L_YOUR_TURN = [30, 86];

// Mario's questions (3aee): a prefix movie, then the rank name movie (148d), one caption
const ASK_BAG = [11575, 11576, 11545, 11557]; // 0x3a70, index starts at 0
const ASK_TEXT = { 11575: "I'm looking for ", 11576: "I'd like to have your ", 11545: "Please give me your ", 11557: "I'm fishing for " };
const RANK_TEXT = ["Goombas", "Piranha Plants", "Rexes", "Bowzers", "Princesses", "Luigis", "Koopas", "Marios", "Little Toadies", "Rip Van Fishes", "Yoshis", "Big Boos", "Bob-ombs"];
const RANK_NAME = [6, 12, 7, 8, 5, 11, 1, 4, 10, 3, 0, 2, 9]; // card frame -> name phrase
const nameMovie = (r, variant) => (variant === 1 ? 11500 : 11513) + RANK_NAME[r];

// Mario's fidgets while the player thinks (1a1b): list 0x39dc, index starts at 0
const IDLE_BAG = [5092, 5093, 5094, 5091];
const IDLE_POS = { 5090: [124, 21], 5091: [125, 16], 5092: [121, 15], 5093: [123, 17], 5094: [121, 14] };

// "YOU WIN!" cards (0x38a4) and their sparkle movies (231b)
const WIN_POS = [[105, 107], [137, 107], [169, 107], [90, 148], [122, 148], [154, 148], [186, 148]];

// data-segment state that outlives a game
let idleFlip = 0; // [0x39da]: idle alternates phrase / fidget
let marioAsk = 0; // [0x8b66]: Mario's last question

const steps = (x0, y0, x1, y1) => (Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) / 14) | 0; // 2cc9
const inRect = (r, x, y) => x >= r.l && x < r.r && y >= r.t && y < r.b;

// ---------------------------------------------------------------- 6ea7: deck, hands, Mario's memory
class Cards {
  // 000b: deck of 4 x 13 ranks, 300 random swaps, 7 cards to the player then 7 to Mario
  constructor(level) {
    this.level = level; // [0x8a56]
    this.memCount = 0; // [0x8840]: only 04b3 counts, and Go Fish never calls it (sic)
    this.player = new Array(52).fill(NONE); // who 2
    this.mario = new Array(52).fill(NONE); // who 3
    this.deck = [];
    for (let i = 0; i < 52; i++) this.deck.push(i >> 2);
    for (let k = 0; k < 300; k++) {
      const a = rnd(52), b = rnd(52);
      [this.deck[a], this.deck[b]] = [this.deck[b], this.deck[a]];
    }
    this.books = new Array(13).fill(0); // owner of each rank's book: 2 player, 3 Mario
    for (this.next = 0; this.next < 7; this.next++) this.player[this.next] = this.deck[this.next];
    for (; this.next < 14; this.next++) this.mario[this.next - 7] = this.deck[this.next];
    this.memory = new Array(200).fill(NONE); // ranks the player asked for
    this.clearRecent();
    this.lastAsked = NONE; // [0x8802]
  }
  hand(who) {
    return who === 3 ? this.mario : this.player;
  }
  sort(who) {
    this.hand(who).sort((a, b) => a - b); // 088e
  }
  size(who) {
    this.sort(who);
    const h = this.hand(who);
    let n = 0;
    while (n < 52 && h[n] !== NONE) n++;
    return n;
  }
  count(who, r) {
    const h = this.hand(who);
    let c = 0;
    for (let i = 0; i < 52 && c !== 4; i++) if (h[i] === r) c++;
    return c;
  }
  left() {
    return 52 - this.next; // 016a
  }
  draw(who) {
    const card = this.next < 52 ? this.deck[this.next++] : NONE; // 05a0
    const h = this.hand(who);
    h[h.indexOf(NONE)] = card;
    this.sort(who);
    return card;
  }
  // 0661: all of `who`'s cards of rank r go to the other hand
  transfer(who, r) {
    const from = this.hand(who), to = this.hand(who === 3 ? 2 : 3);
    let n = 0;
    for (let i = 0; i < 52; i++)
      if (from[i] === r) {
        to[to.indexOf(NONE)] = r;
        from[i] = NONE;
        n++;
      }
    this.sort(3);
    this.sort(2);
    return n;
  }
  bookCount(who) {
    return this.books.filter((b) => b === who).length; // 0703
  }
  findBook(who) {
    this.sort(who); // 07a3
    const h = this.hand(who);
    for (let i = 0; i < 52 && h[i] !== NONE; ) {
      const r = h[i];
      let c = 0;
      while (i < 52 && h[i] === r) {
        c++;
        i++;
      }
      if (c === 4) return r;
    }
    return -1;
  }
  removeBook(who, r) {
    const h = this.hand(who); // 07ff
    for (let i = 0, c = 0; i < 52 && c !== 4; i++)
      if (h[i] === r) {
        h[i] = NONE;
        c++;
      }
    this.sort(who);
    this.forget(r);
    this.books[r] = who;
  }
  remember(r) {
    if (this.memory.includes(r)) return; // 047a
    const i = this.memory.indexOf(NONE);
    if (i >= 0) this.memory[i] = r;
  }
  forget(r) {
    if (this.level) for (let i = 0; i < 200; i++) if (this.memory[i] === r) this.memory[i] = NONE; // 0862
  }
  clearRecent() {
    this.recent = new Array(30).fill(NONE); // 0176: what Mario asked since the player's last turn
  }
  addRecent(r) {
    const i = this.recent.indexOf(NONE);
    if (i >= 0) this.recent[i] = r;
  }
  isRecent(r) {
    return this.recent.includes(r);
  }
  // 01d0: a card of Mario's he has not asked for yet, scanning from a random position
  randomNonRecent() {
    const n = this.size(3), start = rnd(n);
    for (let i = start; i < 52 && this.mario[i] !== NONE; i++) if (!this.isRecent(this.mario[i])) return this.mario[i];
    for (let i = 0; i < start && this.mario[i] !== NONE; i++) if (!this.isRecent(this.mario[i])) return this.mario[i];
    return NONE;
  }
  // 0269: Mario's question. At the level the game uses (2) he asks for the rank the player asked
  // about earliest among those he holds and has not asked this turn, else a random one of his
  // cards; never the same as his previous question if he can help it (5 retries).
  choose() {
    let si = NONE;
    if (this.level === 0) {
      if (this.size(3) === 1) si = this.mario[0];
      else {
        si = this.mario[rnd(this.size(3))];
        for (let k = 0; k < 5 && si === this.lastAsked; k++) si = this.mario[rnd(this.size(3))];
      }
    } else if (this.level === 1 || this.level === 2) {
      const start = rnd(this.memCount); // always 0 (sic)
      let wrapped = false;
      for (let di = start; di < 200; di++) {
        const r = this.memory[di];
        if (r !== NONE && this.count(3, r) && !this.isRecent(r)) {
          si = r;
          break;
        }
        if (!wrapped && di === 199) {
          di = 0; // the increment then skips entry 0 (sic)
          wrapped = true;
          continue;
        }
        if (wrapped && di === start) break;
      }
      if (this.size(3) === 1) si = this.mario[0];
      else if (si === NONE) {
        si = this.randomNonRecent();
        if (si === NONE) si = this.mario[rnd(this.size(3))];
      }
      this.addRecent(si);
    }
    for (let k = 0; k < 5 && si === this.lastAsked; k++) si = this.mario[rnd(this.size(3))];
    this.lastAsked = si;
    this.forget(si);
    return si;
  }
  // 08eb: 0 while cards are left, else 1 tie, 2 player wins, 3 Mario wins
  result() {
    if (this.left()) return 0;
    const p = this.bookCount(2), m = this.bookCount(3);
    return p > m ? 2 : p < m ? 3 : 1;
  }
}

// ---------------------------------------------------------------- intro (overlay 6f3e)
class FishIntro {
  constructor(next) {
    this.next = next;
  }
  enter() {
    const e = this.e;
    e.setPalette(1000);
    if (e.menubar) e.menubar.visible = false;
    this.fish = e.movie(5101);
    this.fish.x = 0;
    this.fish.y = 120;
    this.mario = e.movie(5102);
    this.mario.x = 0;
    this.mario.y = 90;
    this.count = 15; // [0x2f28]: the music starts on the first tick
  }
  go() {
    if (this.gone) return;
    this.gone = true;
    if (this.e.menubar) this.e.menubar.visible = true;
    this.e.setScene(this.next);
  }
  tick() {
    if (this.count === 15) this.e.audio.playMusic(136, false);
    if (this.count > 0) this.count--;
    for (const m of [this.fish, this.mario]) {
      m.sounds();
      m.advanceOnce();
    }
    if (this.fish.done && this.mario.done) this.go();
  }
  render(s) {
    s.clear(0);
    this.e.gfx.bg(5000);
    if (!this.fish.done) this.fish.draw();
    if (!this.mario.done) this.mario.draw();
  }
  pointerDown() {
    this.go();
  }
  key() {
    this.go();
  }
}

// ---------------------------------------------------------------- the game (overlay 7000)
export default class Fish extends GameBase {
  constructor(opts = {}) {
    super();
    this.opts = opts;
  }
  enter() {
    if (!this.opts.skipIntro && !this.introDone) {
      this.introDone = true;
      return this.e.setScene(new FishIntro(this));
    }
    this.init();
  }
  // 7000:0033 + 37cd: resources, the pile, the talking head, then a new game (06b7(0))
  init() {
    this.setup({
      bg: 5001,
      talker: { base: 11000, x: 128, y: 14 },
      captionFont: 224,
      captionRect: { l: 10, t: 191, r: 320, b: 200 },
      table: TABLES.fish,
    });
    this.level = 2; // [0x8bca]
    this.flags = 0; // [0x8d9e]
    this.pendingNew = false; // [0x8d90]
    this.idleCount = 120; // [0x8d94]
    this.flip = this.e.movie(5100); // [0x379a]: the FISH pile, flipping a card when drawn
    this.flip.x = 200;
    this.flip.y = 75;
    this.reach = null; // [0x3798]: Mario reaching for the pile / laying a book down
    this.idleMv = null; // [0x379c]
    this.lights = new Array(7).fill(null); // [0x379e..0x37aa]
    this.flights = [];
    this.cnt = { m: ["", ""], p: ["", ""] }; // card / book counters as drawn (28e8)
    this.startGame(0);
    this.ready = true;
  }

  // ---------------------------------------------------------------- small helpers
  talking() {
    return this.talker.talking; // 1aec:02b0
  }
  say(i) {
    this.talker.hidden = false;
    this.sp.show(ID.body);
    return super.say(i);
  }
  sayRandom(list) {
    return this.say(bagPick(list));
  }
  sayText(movie, text) {
    this.talker.hidden = false;
    this.sp.show(ID.body);
    return this.talker.sayText(movie, text);
  }
  resetHead() {
    this.talker.idle(); // 1aec:032a
    this.talker.hidden = false;
    this.sp.show(ID.body);
  }
  hideHead() {
    this.talker.hidden = true; // 1aec:03c0
    this.sp.hide(ID.body);
  }
  snd(id) {
    this.e.audio.playSnd(id); // 36bf:0207
  }
  modal(promise, then) {
    this.inModal = true;
    promise.then((v) => {
      this.inModal = false;
      this.idleCount = 120;
      if (then) then(v);
    });
  }
  // 28e8: the counters only change when this is called
  updateCounts(who) {
    const c = [String(this.cards.size(who)), String(this.cards.bookCount(who))];
    if (who === 3) this.cnt.m = c;
    else this.cnt.p = c;
  }
  // 3749: the pile is the flip movie resting on its last frame
  showPile(on) {
    const m = this.flip;
    if (on) {
      if (this.flipClosed) {
        this.flip = this.e.movie(5100);
        this.flip.x = 200;
        this.flip.y = 75;
        this.flipClosed = false;
        return this.showPile(1);
      }
      m.t = m.dur - 1;
      m.hidden = false;
    } else m.hidden = true;
    m.paused = true;
  }
  // 3c63:0114 — a frame gliding in a straight line, one point per tick, then the callback
  fly(pak, frame, x0, y0, x1, y1, n, landed) {
    if (!n) return; // 3be9:008a builds no path, so nothing flies and nothing lands (sic)
    this.flights.push({ pak, frame, x0, y0, x1, y1, n, i: 0, x: x0, y: y0, landed });
  }
  tickFlights() {
    for (let k = this.flights.length - 1; k >= 0; k--) {
      const f = this.flights[k]; // newest first, like the list at [0x5b30]
      if (++f.i <= f.n) {
        f.x = f.x0 + Math.trunc(((f.x1 - f.x0) * f.i) / f.n);
        f.y = f.y0 + Math.trunc(((f.y1 - f.y0) * f.i) / f.n);
        continue;
      }
      this.flights.splice(k, 1);
      if (f.landed) f.landed();
    }
  }

  // ---------------------------------------------------------------- the player's hand
  initSlots() {
    this.slots = []; // 327b: {n, rank, vis, x, y}
    for (let i = 0; i < 13; i++) {
      const s = i < 7 ? { n: 1, vis: 1, rank: this.cards.player[i] } : { n: 0, vis: 0, rank: -1 };
      s.x = i < 7 ? SLOT_COL[i] * 33 + 40 : (SLOT_COL[i] - 7) * 33 + 58;
      s.y = i < 7 ? 148 : 107;
      this.slots.push(s);
    }
  }
  dealCard(i) {
    const s = this.slots[i]; // 2960
    if (s.rank === -1) return;
    this.sp.create(s.x, s.y, CARDS, s.rank, ID.face + i);
    this.sp.create(s.x + 4, s.y + 2, PIECES, 0, ID.badge1 + i);
  }
  // 2ee5: the edges of the cards behind (frame 7) and the count badge (frames 0-3)
  decorate(i) {
    const s = this.slots[i], sp = this.sp;
    const has = (id) => !!sp.find(id + i);
    const put = (id, dx, dy, frame) => {
      if (!has(id)) sp.create(s.x + dx, s.y + dy, PIECES, frame, id + i);
    };
    const del = (...ids) => ids.forEach((id) => sp.delete(id + i));
    if (s.n < 1) return del(ID.back1, ID.back2, ID.badge1, ID.badge2, ID.badge3); // not badge4 (sic)
    if (s.n === 1) put(ID.badge1, 4, 2, 0);
    if (s.n === 2) {
      del(ID.badge1);
      put(ID.back1, -2, 0, 7);
      put(ID.badge2, 4, 2, 1);
    }
    if (s.n === 3) {
      del(ID.badge1, ID.badge2);
      put(ID.badge3, 4, 2, 2);
      put(ID.back1, -2, 0, 7);
      put(ID.back2, -4, 0, 7);
    }
    if (s.n === 4) {
      del(ID.badge1, ID.badge2, ID.badge3);
      put(ID.badge4, 4, 2, 3);
    }
  }
  // 2e85: a card landed on slot i
  landed(i) {
    const s = this.slots[i];
    s.vis = 1;
    if (!this.sp.find(ID.face + i)) this.sp.create(s.x, s.y, CARDS, s.rank, ID.face + i);
    this.decorate(i);
  }
  // 2d04: the slot holding rank r, else the first free one
  slotFor(r) {
    let free = 999;
    for (let i = 0; i < 13; i++) {
      if (this.slots[i].rank === r) return i;
      if (!this.slots[i].vis && i < free) free = i;
    }
    return free;
  }
  bookSlot() {
    return this.slots.findIndex((s) => s.n === 4); // 2b41
  }
  // 2db4: slot src's cards fly onto slot dst
  moveSlot(src, dst) {
    const s = this.slots[src], d = this.slots[dst];
    this.sp.delete(ID.face + src);
    d.n += s.n;
    d.rank = s.rank;
    s.n = 0;
    s.rank = -1;
    s.vis = 0;
    this.decorate(src);
    this.fly(CARDS, d.rank, s.x, s.y, d.x, d.y, steps(s.x, s.y, d.x, d.y), () => this.landed(dst));
  }
  // 2d48: two bottom slots with the same rank (only happens after the deal)
  mergeHand() {
    for (let i = 0; i < 7; i++)
      for (let j = i + 1; j < 7; j++) {
        const a = this.slots[i], b = this.slots[j];
        if (a.vis && b.vis && a.rank === b.rank) {
          this.moveSlot(j, i);
          return true;
        }
      }
    return false;
  }
  // 3398: one step of closing the gaps — the top row comes down first, then cards slide towards
  // the centre of their row. A gap in the centre slot is never filled from the sides (sic).
  compactHand() {
    const sl = this.slots, n = (i) => sl[i].n;
    const topVisible = () => sl.slice(7).some((s) => s.vis); // 36dc
    const lastTop = () => {
      for (let i = 12; i >= 7; i--) if (sl[i].vis) return i; // 3701(2)
      return -1;
    };
    // nearest visible slot left / right of slot i's column, within its row (348a / 3502)
    const leftOf = (i) => {
      const lo = i < 7 ? 0 : 7;
      for (let c = SLOT_COL[i] - 1; c >= lo; c--) if (sl[COL_SLOT[c]].vis) return COL_SLOT[c];
      return -1;
    };
    const rightOf = (i) => {
      const hi = i < 7 ? 7 : 13;
      for (let c = SLOT_COL[i] + 1; c < hi; c++) if (sl[COL_SLOT[c]].vis) return COL_SLOT[c];
      return -1;
    };
    let src = -1, dst = -1;
    let t = -1;
    if (topVisible()) for (let i = 6; i >= 0; i--) if (!sl[i].vis) { t = i; break; } // 36b6
    if (t !== -1) {
      src = lastTop(); // (365f picks the nearest top card, but its answer is unused (sic))
      dst = t;
    } else {
      let g = -1; // 357b: a gap in the bottom row
      if (!n(4) && n(6)) g = 4;
      else if (!n(3) && n(5)) g = 3;
      else if (!n(2) && (n(4) || n(6))) g = 2;
      else if (!n(1) && (n(3) || n(5))) g = 1;
      else if (!n(0) && (n(1) || n(3) || n(5))) g = 0;
      if (g !== -1) {
        dst = g;
        if (topVisible()) src = lastTop();
        else if (g >= 1) src = g & 1 ? rightOf(g) : leftOf(g);
      } else {
        let u = -1; // 35fd: a gap in the top row
        if (!n(10) && n(12)) u = 10;
        else if (!n(8) && (n(10) || n(12))) u = 8;
        else if (!n(7) && (n(9) || n(11))) u = 7;
        else if (!n(9) && n(11)) u = 9;
        if (u !== -1) {
          dst = u;
          src = u === 8 || u === 10 ? leftOf(u) : rightOf(u);
        }
      }
    }
    if (src === -1 || dst === -1) return false;
    this.moveSlot(src, dst);
    return true;
  }
  // 282b: the highlighted card under the pointer (Pak 5009), badge kept on top
  highlight(k) {
    let found = false;
    for (let i = 0; i < 13; i++)
      if (this.sp.find(ID.hilit + i)) {
        if (i === k) found = true;
        else this.sp.delete(ID.hilit + i);
      }
    if (k < 0 || found || !this.slots[k].vis) return;
    const s = this.slots[k];
    this.sp.create(s.x, s.y, HILIT, s.rank, ID.hilit + k);
    const badge = [0, ID.badge1, ID.badge2, ID.badge3][s.n];
    if (badge) this.sp.toFront(badge + k);
  }
  // 2bda: the player takes the top card; it shows at (220,66)
  drawCard() {
    let card = -1;
    if (this.cards.left()) {
      card = this.cards.draw(2);
      this.sp.create(220, 66, CARDS, card, ID.drawn);
      this.updateCounts(3);
      this.updateCounts(2);
    }
    if (!this.cards.left()) this.showPile(0);
    return card;
  }
  // 2c40: ...and flies into the hand
  flyDrawn(card) {
    this.sp.delete(ID.drawn);
    const i = this.slotFor(card), s = this.slots[i];
    const n = steps(s.x, s.y, 220, 66);
    s.n++;
    s.rank = card;
    this.fly(CARDS, card, 220, 66, s.x, s.y, n, () => this.landed(i));
  }
  // 264b: the cards Mario holds up at (150,70) fly to the player's slot
  giveFly(r) {
    for (const id of [ID.held, ID.held2, ID.held3]) this.sp.delete(id);
    const i = this.slotFor(r), s = this.slots[i];
    const n = this.cards.transfer(3, r);
    this.updateCounts(3);
    this.updateCounts(2);
    s.n += n;
    s.rank = r;
    let x = 150, tx = s.x;
    const k = steps(150, 70, s.x, s.y) + 2;
    this.fly(CARDS, s.rank, x, 70, tx, s.y, k, () => this.landed(i));
    if (n === 2 || n === 3) this.fly(PIECES, 7, (x -= 2), 70, (tx -= 2), s.y, k);
    if (n === 3) this.fly(PIECES, 7, (x -= 2), 70, (tx -= 2), s.y, k);
  }
  // 277c: Mario takes the player's cards of rank r
  takeFly(r) {
    const i = this.slotFor(r), s = this.slots[i];
    this.sp.delete(ID.face + i);
    this.cards.transfer(2, r);
    this.fly(CARDS, s.rank, s.x, s.y, 150, 70, steps(s.x, s.y, 150, 70));
    s.n = 0;
    s.rank = -1;
    s.vis = 0;
    this.decorate(i);
  }
  // 2b6c: where the next book goes — the player's stack grows up from the bottom right (counted
  // after the book is added), Mario's down from (2,91) (counted before)
  bookPos(who) {
    const n = this.cards.bookCount(who);
    if (who === 2) return [294 - ((n / 7) | 0) * 25, 178 - (n % 7) * 10];
    return [((n / 7) | 0) * 22 + 2, (n % 7) * 9 + 91];
  }
  // 29d9: the player's four of a kind fly to the book stack (Pak 5006 frame 5 when it lands)
  bookFly() {
    const i = this.bookSlot(), s = this.slots[i];
    this.cards.removeBook(2, s.rank);
    let [tx, ty] = this.bookPos(2);
    if (ty > 160) ty = 160;
    if (tx > 292) tx = 292;
    const n = steps(s.x, s.y, tx, ty);
    for (const id of [ID.back1, ID.back2, ID.badge4, ID.face]) this.sp.delete(id + i);
    this.fly(CARDS, s.rank, s.x, s.y, tx, ty, n, () => {
      const [x, y] = this.bookPos(2); // 2ac7
      this.sp.create(x, y, PIECES, 5);
      this.snd(5010);
    });
    s.n = 0;
    s.rank = -1;
    s.vis = 0;
  }
  // 2aff: Mario lays his book down (Pak 5006 frame 4)
  marioBookDown() {
    this.snd(5010);
    const [x, y] = this.bookPos(3);
    this.sp.create(x, y, PIECES, 4);
    this.cards.removeBook(3, this.cards.findBook(3));
  }
  // 3aee: "I'm looking for Goombas." / "Do you have any Goombas?"
  askPhrase(r) {
    let movie, text, variant;
    if (rnd(4)) {
      movie = bagPick(ASK_BAG, 0);
      text = ASK_TEXT[movie];
      variant = 1;
    } else {
      movie = 11546;
      text = "Do you have any ";
      variant = 2;
    }
    return { movie, variant, text: text + RANK_TEXT[r] + (variant === 1 ? "." : "?") };
  }
  closeLights() {
    this.lights.fill(null); // 2437
    for (let i = 0; i < 7; i++) this.sp.delete(ID.win + i);
  }

  // ---------------------------------------------------------------- 06b7: a new game
  startGame(arg) {
    if (arg === 0) {
      this.closeLights();
      this.dealt = 0; // [0x8b58]
      this.st = 0; // [0x8b54]
      this.marioFished = false; // [0x8d92]
      this.turn = 0; // [0x8d9c]: 2 player, 3 Mario
      this.cards = new Cards(this.level);
      this.initSlots();
      this.sp.clear();
      this.flights = [];
      this.sp.create(122, 55, 5300, 0, ID.body);
      this.resetHead();
      this.sp.create(3, 11, PIECES, 8, ID.boxM); // 39e0: the yellow frame of whose turn it is
      this.sp.create(218, 11, PIECES, 8, ID.boxP);
      this.sp.hide(ID.boxP);
      this.showPile(1);
      this.updateCounts(3);
      this.updateCounts(2);
      this.flags = 0;
      return;
    }
    switch (this.st) {
      case 0:
        this.st++;
        return;
      case 1: // 3c36: the name, once per session
        this.st++;
        if (this.e.app && !this.e.app.nameAsked) {
          this.e.app.nameAsked = true;
          this.modal(this.e.app.askName(), () => this.updateCounts(2));
        }
        return;
      case 2:
        this.sayRandom(L_GREET);
        this.st++;
        return;
      case 3:
        if (this.talking()) return;
        this.resetHead();
        this.cntDown = 5;
        this.st++;
        return;
      case 4:
        if (this.cntDown-- > 0) return;
        this.st++;
        return;
      case 5: // a card every other tick, popping into the slots from the centre out
        if (this.dealt < 7) {
          this.dealCard(this.dealt++);
          this.snd(5032);
          this.cntDown = 1;
          this.st = 4;
        } else {
          this.cntDown = 1;
          this.st++;
        }
        return;
      case 6:
        if (this.cntDown-- > 0) return;
        this.st++;
        return;
      case 7:
        if (this.flights.length) return;
        this.st++;
        return;
      case 8:
        this.st = this.mergeHand() ? 7 : 9;
        return;
      case 9:
        this.st = this.compactHand() ? 7 : 10;
        return;
      case 10:
        this.say(29); // "I go first."
        this.st++;
        return;
      case 11:
        if (this.talking()) return;
        this.resetHead();
        this.st++;
        this.cntDown = 10;
        return;
      case 12:
        if (this.cntDown-- > 0) return;
        this.turn = 3;
        this.marioTurn(0);
        this.st++;
        return;
    }
  }

  // ---------------------------------------------------------------- 08e3: the player's turn
  playerTurn(arg) {
    if (arg === 0) {
      this.sp.show(ID.boxP);
      this.sp.hide(ID.boxM);
      this.cards.clearRecent();
      this.gotWanted = 0; // [0x8b5c]
      this.turn = 2;
      this.idleCount = 120;
      const p = this.e.pointer, hit = this.hitRegion(p.x, p.y);
      if (hit === -1) this.highlight(-1);
      else if (hit !== PILE && this.slots[hit].vis) this.highlight(hit);
      if (!this.cards.size(2) && !this.cards.left()) {
        this.showPile(0);
        this.flags |= 0x1000;
        this.endGame(0);
        this.pst = 999;
        return;
      }
      this.pst = 0;
      return;
    }
    switch (this.pst) {
      case 0:
        if (!this.cards.size(2)) {
          this.say(38); // "I guess you need another card."
          this.pst++;
        } else this.pst = 6;
        return;
      case 1:
        if (this.talking()) return;
        this.resetHead();
        this.playerFish(0);
        this.pst++;
        return;
      case 2:
        if (this.playerFish(1) !== 11) return;
      // falls through (0a62)
      case 3:
        if (this.bookSlot() !== -1) {
          this.playerBook(0);
          this.pst++;
        } else this.pst = 6;
        return;
      case 4:
        if (this.playerBook(1) !== 11) return;
        this.compactHand();
        this.pst++;
        return;
      case 5:
        if (this.flights.length) return;
        this.updateCounts(2);
        this.playerTurn(0);
        return;
      case 6:
        if (this.cards.bookCount(2) > this.cards.bookCount(3) + 1) {
          this.sayRandom(L_PRAISE);
          this.pst++;
        } else this.pst = 8;
        return;
      case 7:
        if (this.talking()) return;
        this.resetHead();
        this.pst++;
        return;
      case 8:
        this.updateCounts(2);
        this.flags |= 8; // waiting for a card to be picked
        this.choice = -1; // [0x8d9a]
        this.idleCount = 120;
        if (this.flags & 0x200) {
          this.pst = 10;
          return;
        }
        this.sayRandom(L_YOUR_TURN);
        this.pst++;
        return;
      case 9:
        if (this.talking()) return;
        this.resetHead();
        this.pst++;
        return;
      case 10:
        if (!(this.flags & 0x100) && this.idleCount-- <= 0) return this.idle(0);
        if (this.flags & 0x100 || this.choice === -1) return;
        this.pst++;
        return;
      case 11:
        this.cards.remember(this.choice);
        if (this.cards.count(3, this.choice)) {
          this.marioGive(0, this.choice);
          this.pst++;
        } else this.pst = 30;
        return;
      case 12:
        if (this.marioGive(1) !== 11) return;
        this.choice = -1;
        if (this.bookSlot() !== -1) {
          this.playerBook(0);
          this.pst++;
        } else this.playerTurn(0);
        return;
      case 13:
        if (this.playerBook(1) !== 11) return;
        this.compactHand();
        this.pst++;
        return;
      case 14:
        if (this.flights.length) return;
        this.updateCounts(2);
        this.pst++;
        return;
      case 15:
        this.playerTurn(0);
        return;
      case 30:
        this.say(28); // "Go fish!"
        this.pst++;
        return;
      case 31:
        if (this.talking()) return;
        this.resetHead();
        this.playerFish(0);
        this.pst++;
        return;
      case 32:
        if (!(this.flags & 0x100) && this.idleCount-- <= 0) return this.idle(0);
        if (this.flags & 0x100) return;
        if (this.playerFish(1) !== 11) return;
        if (this.drawn === this.choice) this.gotWanted = 1;
        if (this.bookSlot() !== -1) {
          this.playerBook(0);
          this.pst++;
        } else this.pst = 34;
        return;
      case 33:
        if (this.playerBook(1) !== 11) return;
        this.compactHand();
        this.pst++;
        return;
      case 34:
        if (this.flights.length) return;
        this.updateCounts(2);
        this.choice = -1;
        if (this.gotWanted) {
          this.pst++;
          return;
        }
        this.turn = 3;
        this.marioTurn(0);
        this.pst = 999;
        return;
      case 35:
        this.sayRandom(L_YOU_GOT);
        this.pst++;
        return;
      case 36:
        if (this.talking()) return;
        this.resetHead();
        this.playerTurn(0);
        return;
    }
  }

  // 0e89: the player clicks the pile, the top card flips over and flies into the hand
  playerFish(arg) {
    if (arg === 0) {
      this.flags &= ~1;
      this.flags &= ~8;
      this.highlight(-1);
      this.drawn = -1; // [0x8d98]
      if (this.cards.left()) {
        this.fst = 0;
        return 0;
      }
      this.showPile(0);
      this.flags |= 0x1000;
      this.fst = 999;
      this.endGame(0); // (fix) the original sets "game over" here without starting the ending and hangs
      return 0;
    }
    if (!(this.flags & 1)) return 0;
    const m = this.flip;
    switch (this.fst) {
      case 0:
        m.paused = false;
        m.done = false;
        m.t = 0;
        this.fst++;
        return 0;
      case 1:
        if (m.t === m.step * 6) this.snd(5027);
        if (m.t > m.step * 13) {
          this.drawn = this.drawCard();
          this.fishDelay = 2; // [0x8b5e]
          this.fst++;
        }
        return 0;
      case 2:
        if (this.fishDelay-- !== 0) return 0;
        this.flyDrawn(this.drawn);
        this.fst++;
        return 0;
      case 3:
        if (this.flights.length) return 0;
        this.flags &= ~1;
        this.fst = 999;
        return 11;
    }
    return 0;
  }

  // 0fbd: "That's one book for you." and the four cards fly to the stack
  playerBook(arg) {
    if (arg === 0) {
      this.highlight(-1);
      this.bst = 0;
      return 0;
    }
    switch (this.bst) {
      case 0:
        this.say(this.cards.bookCount(2) ? 32 : 31);
        this.bst++;
        return 0;
      case 1:
        if (this.talking()) return 0;
        this.resetHead();
        this.bst++;
        return 0;
      case 2:
        this.bookFly();
        this.bst++;
        return 0;
      case 3:
        if (this.flights.length) return 0;
        this.bst++;
        return 0;
      case 4:
        this.bst = 999; // (0e23(0) flags a hand tidy-up that nothing ever runs (sic))
        return 11;
    }
    return 0;
  }

  // 1c93: Mario has the rank the player asked for — he holds the cards up and hands them over
  marioGive(arg, r) {
    if (arg === 0) {
      this.giveRank = r; // [0x8b76]
      this.flags |= 2;
      if (this.cards.size(3)) this.gst = 0;
      else {
        this.flags |= 0x1000;
        this.gst = 999;
      }
      return 0;
    }
    switch (this.gst) {
      case 0:
        this.giveN = this.cards.count(3, this.giveRank);
        if (this.giveN === 3) this.sayRandom(L_OH_NO);
        this.gst++;
        return 0;
      case 1:
        if (this.talking()) return 0;
        this.resetHead();
        this.say(32 + this.giveN); // "Yes, I have one card." ...
        this.gst++;
        return 0;
      case 2:
        if (this.talking()) return 0;
        this.resetHead();
        this.gst++;
        return 0;
      case 3: {
        let x = 150;
        this.sp.create(x, 70, CARDS, this.giveRank, ID.held);
        if (this.giveN === 2 || this.giveN === 3) this.sp.create((x -= 2), 70, PIECES, 7, ID.held2);
        if (this.giveN === 3) this.sp.create((x -= 2), 70, PIECES, 7, ID.held3);
        this.gcnt = 5;
        this.gst++;
        return 0;
      }
      case 4:
        if (this.gcnt-- > 0) return 0;
        this.gst++;
        return 0;
      case 5:
        this.giveFly(this.giveRank);
        this.gst++;
        return 0;
      case 6:
        if (this.flights.length) return 0;
        this.gst++;
        return 0;
      case 7: // a book from these cards is laid down here, without the tidy-up after it (sic)
        if (this.bookSlot() !== -1) {
          this.playerBook(0);
          this.gst++;
        } else this.gst = 9;
        return 0;
      case 8:
        if (this.playerBook(1) === 11) this.gst++;
        return 0;
      case 9:
        this.updateCounts(2);
        this.flags &= ~2;
        this.gst = 999;
        return 11;
    }
    return 0;
  }

  // ---------------------------------------------------------------- 104a: Mario's turn
  marioTurn(arg) {
    if (arg === 0) {
      this.sp.show(ID.boxM);
      this.sp.hide(ID.boxP);
      this.flags &= ~4;
      this.flags &= ~0x10;
      this.updateCounts(3);
      this.updateCounts(2);
      if (this.cards.size(3)) {
        this.mst = 0; // [0x8b60]
        return;
      }
      if (this.cards.left()) {
        this.askedRank = -1; // [0x8d96]
        this.mst = 51;
        return;
      }
      this.showPile(0);
      // (fix) with cards still in the player's hand the original returns here and hangs
      this.flags |= 0x1000;
      this.flags &= ~0x10;
      this.afterTake = 0;
      this.endGame(0);
      this.mst = 999;
      return;
    }
    if (this.flags & 0x200) return;
    switch (this.mst) {
      case 0:
        if (!this.cards.size(2) && this.cards.left()) {
          this.say(38); // the player has no cards: he draws one first
          this.mst++;
        } else this.mst = 30;
        return;
      case 1:
        if (this.talking()) return;
        this.resetHead();
        this.playerFish(0);
        this.mst++;
        return;
      case 2:
        if (this.playerFish(1) !== 11) return;
        this.mst = 30;
      // falls through
      case 30:
        this.afterTake = 0; // [0x39d2]
        // "Hmm..." / "Let's see ..." would come here, but rand() / 32768 is always 0 (sic)
        this.mst++;
        return;
      case 31: {
        if (this.talking()) return;
        this.updateCounts(3);
        this.ask = marioAsk = this.cards.choose();
        this.askedRank = this.ask;
        this.flags |= 4;
        this.sp.create(108, 30, ICONS, this.ask, ID.askIcon); // 39a3
        const a = this.askPhrase(this.ask);
        this.askVariant = a.variant;
        this.askText = a.text;
        this.sayText(a.movie, a.text);
        this.mst++;
        return;
      }
      case 32:
        if (this.talking()) return;
        this.sayText(nameMovie(this.ask, this.askVariant), this.askText);
        this.mst++;
        return;
      case 33:
        if (this.talking()) return;
        this.resetHead();
        this.mcnt = 5;
        this.mst++;
        return;
      case 34:
        if (this.mcnt-- > 0) return;
        if (this.cards.count(2, this.ask)) {
          this.mst = 10;
          return;
        }
        if (this.cards.left()) {
          this.flags &= ~4;
          this.mst = 50;
          return;
        }
        this.showPile(0);
        this.flags |= 0x1000;
        this.sp.delete(ID.askIcon); // (its Pak is released here)
        this.endGame(0);
        this.mst = 999;
        return;
      case 10:
        this.marioTake(0, this.ask);
        this.mst++;
        return;
      case 11:
        if (this.marioTake(1) === 11) this.mst++;
        return;
      case 12:
        this.sp.delete(ID.askIcon);
        if (this.cards.findBook(3) !== -1) {
          this.marioBook(0);
          this.mst++;
        } else this.mst = 14;
        return;
      case 13:
        if (this.marioBook(1) !== 11) return;
        this.updateCounts(3);
        this.mst++;
        return;
      case 14:
        this.afterTake = 1;
        this.mst++;
        return;
      case 15:
        this.updateCounts(3);
        this.marioTurn(0);
        return;
      case 50: // the player has none: "Mario, go fish!" (a separate voice sample, no lip sync)
        this.flags |= 0x10;
        this.sp.delete(ID.askIcon);
        this.talker.sayText(0, "Mario, go fish!");
        this.snd(26015);
        this.resetHead();
        this.mst = 51;
        return;
      case 51:
        if (this.e.audio.playing()) return; // 36bf:043e
        this.marioDraw(0, this.afterTake ? -1 : marioAsk);
        this.afterTake = 0;
        this.mst = 52;
        return;
      case 52: {
        const r = this.marioDraw(1);
        if (r === 10) {
          this.marioTurn(0);
          this.resetHead();
        } else if (r === 11) {
          this.turn = 2;
          this.flags &= ~4;
          this.playerTurn(0); // (1590 already did, so twice (sic))
          this.resetHead();
          this.mst = 999;
        }
        if (!this.cards.left()) this.showPile(0);
        return;
      }
    }
  }

  // 1c22: Mario takes the player's cards of the rank he asked for
  marioTake(arg, r) {
    if (arg === 0) {
      this.takeRank = r;
      this.tst = this.cards.size(2) ? 0 : 999;
      return 0;
    }
    if (this.tst === 0) {
      this.takeFly(this.takeRank);
      this.tst++;
    } else if (this.tst === 1 && !this.flights.length) {
      this.tst = 999;
      this.updateCounts(3);
      this.updateCounts(2);
      return 11;
    }
    return 0;
  }

  // 18b7: "That's one book for Mario." — he lays it down on his side (movie 5020)
  marioBook(arg) {
    if (arg === 0) {
      this.kst = 0;
      this.flags |= 0x400;
      return 0;
    }
    if (!(this.flags & 0x400)) return 0;
    switch (this.kst) {
      case 0:
        this.say(this.cards.bookCount(3) ? 48 : 47);
        this.kst++;
        return 0;
      case 1:
        if (this.talking()) return 0;
        this.kst++;
        return 0;
      case 2: {
        this.hideHead();
        const m = (this.reach = this.e.movie(5020));
        m.x += 3;
        this.bookAt = m.dur - m.step * 3; // [0x8b72]
        this.kst++;
        return 0;
      }
      case 3:
        if (this.reach && this.reach.t < this.bookAt) return 0;
        this.marioBookDown();
        this.kst++;
        return 0;
      case 4:
        if (this.reach && !this.reach.done) return 0;
        this.reach = null;
        this.resetHead();
        this.flags &= ~0x400;
        this.kst = 999;
        return 11;
    }
    return 0;
  }

  // 1590: Mario fishes (movie 5019); returns 10 when he goes again, 11 when the turn passes
  marioDraw(arg, asked) {
    if (arg === 0) {
      this.drawAsked = asked; // [0x8b6a]
      this.again = asked === -1 ? 1 : 0; // [0x8b70]
      if (this.cards.left()) {
        this.flags |= 0x800;
        this.dst = 0;
      } else {
        this.showPile(0);
        this.flags &= ~0x800;
        this.dst = 999;
      }
      return 0;
    }
    if (!(this.flags & 0x800)) return 0;
    const toPlayer = () => {
      this.turn = 2; // 1844
      this.playerTurn(0);
      this.flags &= ~0x10;
      this.flags &= ~0x800;
      this.dst = 999;
      return 11;
    };
    const again = () => {
      this.dst = 999;
      this.flags &= ~0x10;
      this.flags &= ~0x800;
      return 10;
    };
    switch (this.dst) {
      case 0:
        if (this.marioFished) this.sayRandom(L_MARIO_FISH);
        else this.say(51); // "I guess I'm going fishing."
        this.marioFished = true;
        this.dst++;
        return 0;
      case 1:
        if (this.talking()) return 0;
        this.resetHead();
        this.dst++;
        return 0;
      case 2:
        this.hideHead();
        this.reach = this.e.movie(5019);
        this.reach.x = 121;
        this.reach.y = 13;
        this.dst++;
        return 0;
      case 3:
        if (this.reach && !this.reach.done) return 0;
        this.reach = null;
        this.resetHead();
        this.drawnM = this.cards.draw(3); // [0x8b6c]
        this.updateCounts(3);
        if (!this.cards.left()) this.showPile(0);
        this.dst++;
        return 0;
      case 4:
        if (this.again) return again(); // he had no cards: now he can ask
        if (this.cards.findBook(3) !== -1) {
          this.marioBook(0);
          this.dst++;
        } else this.dst = 6;
        return 0;
      case 5:
        if (this.marioBook(1) !== 11) return 0;
        this.updateCounts(3);
        this.dst++;
        return 0;
      case 6:
        if (this.drawnM === this.drawAsked) {
          this.again = 1;
          if (this.cards.size(3)) {
            this.dst++;
            return 0;
          }
        }
        this.dst = 30;
        return 0;
      case 7:
        this.sayRandom(L_MARIO_GOT);
        this.dst++;
        return 0;
      case 8:
        if (this.talking()) return 0;
        this.resetHead();
        this.dcnt = 5;
        this.updateCounts(3);
        this.dst++;
        return 0;
      case 9:
        if (this.dcnt-- > 0) return 0;
        return again();
      case 30:
        if (this.cards.size(3) || !this.cards.left()) return toPlayer();
        this.dst++;
      // falls through
      case 31:
        this.say(53); // "I guess I need another card."
        this.dst++;
        return 0;
      case 32:
        if (this.talking()) return 0;
        this.resetHead();
        this.updateCounts(3);
        if (!this.cards.left()) this.showPile(0);
        if (this.again && this.cards.size(3) > 0) return again();
        if (this.again && !this.cards.size(3)) {
          this.marioDraw(0, -1);
          return 0;
        }
        return toPlayer(); // without his card he still passes the turn (sic)
    }
    return 0;
  }

  // ---------------------------------------------------------------- 1a1b: Mario gets impatient
  idle(arg) {
    if (arg === 0) {
      this.ist = idleFlip++ & 1 ? 0 : 5; // a phrase, then a fidget, and so on
      this.idleCount = 120;
      this.flags |= 0x100;
      return;
    }
    if (!(this.flags & 0x100)) return;
    switch (this.ist) {
      case 0: {
        const id = bagPick(IDLE_BAG, 0);
        const m = (this.idleMv = this.e.movie(id));
        [m.x, m.y] = IDLE_POS[id] || [121, 18];
        this.hideHead();
        this.ist++;
        return;
      }
      case 1:
        if (this.idleMv && !this.idleMv.done) return;
        this.idleMv = null;
        this.resetHead();
        this.ist = 10;
        return;
      case 5:
        this.sayRandom(L_IDLE); // "Hey, what's taking so long?"
        this.ist++;
        return;
      case 6:
        if (this.talking()) return;
        this.resetHead();
        this.ist = 10;
        return;
      case 10:
        this.idleCount = 120;
        this.flags &= ~0x100;
        this.ist = 999;
        return;
    }
  }

  // ---------------------------------------------------------------- 213b: New Game from the menu
  newGameRequest() {
    if (!this.ready || this.inModal) return;
    this.idleCount = 120;
    if (this.flags & 0xf10) this.pendingNew = true; // busy: asked again when it is quiet
    else this.newGame(0);
  }
  newGame(arg) {
    if (arg === 0) {
      this.nst = 0;
      this.savedFlags = this.flags;
      this.flags = 0;
      this.reach = null;
      this.flags |= 0x200;
      return;
    }
    if (!(this.flags & 0x200)) return;
    switch (this.nst) {
      case 0:
        if (this.talking()) return;
        this.ncnt = 1;
        this.nst++;
        return;
      case 1:
        if (this.ncnt-- >= 0) return;
        this.say(72); // "Are you sure you want to start another game?"
        this.nst++;
        return;
      case 2:
        if (this.talking()) return;
        this.ncnt = 2;
        this.nst++;
        return;
      case 3:
        if (this.ncnt-- >= 0) return;
        this.nst = 999;
        this.modal(this.dlgStartOver(), (yes) => {
          if (yes) return this.restart();
          this.flags &= ~0x200;
          this.flags |= this.savedFlags;
        });
        return;
    }
  }

  // ---------------------------------------------------------------- 1e7a: the end
  endGame(arg) {
    if (arg === 0) {
      this.sp.hide(ID.boxM);
      this.sp.hide(ID.boxP);
      this.winIdx = 0; // [0x8b7e]
      this.est = 0; // [0x39ea]
      return;
    }
    if (!(this.flags & 0x1000)) return;
    switch (this.est) {
      case 0:
        this.result = this.cards.result();
        if (this.result === 3) this.sayRandom(L_MARIO_WINS);
        else if (this.result === 2) this.sayRandom(L_YOU_WIN); // a tie says nothing
        this.est++;
        return;
      case 1:
        if (this.talking()) return;
        this.resetHead();
        if (this.result !== 2) {
          this.est = 30;
          this.ecnt = 2;
          return;
        }
        this.showPile(0);
        this.sp.create(220, 66, YOU_WIN, 0, ID.youWin);
        this.snd(5013);
        this.ecnt = 5;
        this.est++;
        return;
      case 2:
        if (this.ecnt-- > 0) return;
        this.sp.delete(ID.youWin);
        this.showPile(1);
        this.e.audio.playMusic(137, false);
        this.est++;
        return;
      case 3: // the pile turns up the next "YOU WIN!" card...
        this.flip.paused = false;
        this.flip.done = false;
        this.flip.t = this.flip.step * 14;
        this.est++;
        return;
      case 4:
        if (!this.flip.paused) return;
        this.sp.create(220, 66, WIN_CARDS, this.winIdx, ID.win + this.winIdx);
        this.ecnt = 2;
        this.est++;
        return;
      case 5: {
        // ...which flies to its place (223e) and gets its sparkle movie (2602 / 231b)
        if (this.ecnt-- !== 0) return;
        const i = this.winIdx, [x, y] = WIN_POS[i];
        this.sp.delete(ID.win + i);
        this.fly(WIN_CARDS, i, 220, 66, x, y, ((steps(220, 66, x, y) / 2) | 0) + 1, () => {
          this.sp.create(x, y, WIN_CARDS, i, ID.win + i);
          const m = (this.lights[i] = this.e.movie(5210));
          m.x = x;
          m.y = y;
          m.paused = true;
        });
        this.est++;
        return;
      }
      case 6:
        if (this.flights.length) return;
        if (++this.winIdx < 7) {
          this.est = 3;
          return;
        }
        this.showPile(0);
        this.flipClosed = true;
        this.est++;
        return;
      case 7:
        for (const m of this.lights) if (m) m.paused = false;
        this.lightsCnt = 40;
        this.est++;
        return;
      case 8:
        if (this.lightsCnt-- >= 0) return;
        this.closeLights();
        this.ecnt = 2;
        this.est++;
        return;
      case 9:
        if (this.ecnt-- !== 0) return;
        this.say(71); // "Hey! Do you want to play another game?"
        this.est++;
        return;
      case 10:
        if (this.talking()) return;
        this.resetHead();
        this.ecnt = 2;
        this.est = 30;
        return;
      case 30:
        if (this.ecnt-- !== 0) return;
        this.est = 999;
        this.modal(this.dlgPlayAgain(), (yes) => (yes ? this.restart() : this.e.app.mainMenu(true)));
        return;
    }
  }

  // ---------------------------------------------------------------- input (7000:0238 / 0322)
  // 26ac:000a over the hit list at 0x37c4: the 13 slots (whether or not they hold a card), then
  // the pile
  hitRegion(x, y) {
    for (let i = 0; i < 13; i++) {
      const s = this.slots[i];
      if (x >= s.x && x < s.x + 28 && y >= s.y && y < s.y + 40) return i;
    }
    return inRect(this.e.pointer.type === "mouse" ? PILE_RECT : PILE_TOUCH, x, y) ? PILE : -1;
  }
  pointerDown(x, y) {
    if (!this.ready || this.inModal) return;
    this.idleCount = 120;
    const hit = this.hitRegion(x, y);
    if (hit === -1) return;
    if (this.turn === 3) {
      // in Mario's turn the pile only answers when the player has to draw a card first
      if (!this.cards.size(2) && hit === PILE) this.flags |= 1;
      return;
    }
    if (this.turn !== 2) return;
    if (hit === PILE) this.flags |= 1;
    else if (this.flags & 8 && this.slots[hit].vis) {
      this.choice = this.slots[hit].rank;
      this.flags &= ~8;
    }
  }
  pointerMove(x, y) {
    if (!this.ready || this.inModal) return;
    const hit = this.hitRegion(x, y);
    if (hit === -1) return this.highlight(-1);
    if (hit !== PILE && this.flags & 8 && !(this.flags & 2) && this.turn === 2) this.highlight(hit);
  }
  key() {
    this.idleCount = 120;
  }

  // ---------------------------------------------------------------- tick / render (03b2 / 060b)
  tick() {
    if (!this.ready || this.inModal) return;
    if (this.pendingNew && !this.talking() && !(this.flags & 0xf10)) {
      this.pendingNew = false;
      this.newGame(0);
    }
    for (const m of [this.flip, this.reach, this.idleMv]) if (m) m.sounds();
    this.tickFlights();
    for (const m of [this.flip, this.reach, this.idleMv]) if (m) m.advanceOnce();
    for (const m of this.lights) if (m) m.advanceLoop();
    this.startGame(1);
    if (!(this.flags & 0x1000)) {
      if (this.turn === 2) this.playerTurn(1);
      else if (this.turn === 3) this.marioTurn(1);
    }
    this.idle(1);
    this.newGame(1);
    this.endGame(1);
    this.talker.tick();
  }
  // 3c5d: score-board text, glyph advances by its own width (spaces too)
  str(s, max, x, y) {
    const g = this.e.gfx, p = this.e.prs.pak(223);
    for (const c of s.slice(0, max)) {
      const f = p.frames[g.glyph(c.charCodeAt(0))];
      g.s.blit(f, x, y);
      x += f.x + f.w;
    }
  }
  render(scr) {
    const g = this.e.gfx;
    scr.clear(0);
    g.bg(5001);
    if (!this.ready) return;
    if (!this.flipClosed) this.flip.draw();
    if (this.reach) this.reach.draw();
    this.sp.draw();
    this.talker.drawText();
    this.talker.draw();
    if (this.idleMv) this.idleMv.draw();
    // 386d: score boards (Mario left, the player right)
    this.str(this.e.prefs.name || "My Friend", 11, 230, 19);
    this.str("MARIO", 5, 15, 19);
    this.str("CARDS", 5, 15, 44);
    this.str("CARDS", 5, 230, 44);
    this.str("BOOKS", 5, 15, 35);
    this.str("BOOKS", 5, 230, 35);
    this.str(this.cnt.m[0], 3, 60, 44);
    this.str(this.cnt.m[1], 3, 60, 35);
    this.str(this.cnt.p[0], 3, 275, 44);
    this.str(this.cnt.p[1], 3, 275, 35);
    for (const m of this.lights) if (m) m.draw();
    for (let k = this.flights.length - 1; k >= 0; k--) {
      const f = this.flights[k]; // the newest is drawn first, under the older ones
      g.frame(f.pak, f.frame, f.x, f.y);
    }
  }
}
