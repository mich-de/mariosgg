// Checkers (overlays 659c intro, 6000 flow, 617d board drawing and animation, 633c geometry,
// 63e7 move input and rules; Mario's search engine is the main-code segment 1a5d), ported routine
// by routine from the original's tick-driven state machines. Quirks are kept and marked (sic).
//
// Rules as the original plays them: the player picks Yoshi or Koopa and moves first, Mario plays
// the other side from the top of the board. Men step diagonally forward, kings both ways; a man
// reaching the far row is crowned there. With "Forced Jumps" on (the default) a capture must be
// taken and a jump goes on while the same piece can jump again. Mario "clicks" his moves through
// the same input routine the player uses; he finds them with a plain minimax (no pruning) whose
// depth starts at 2 plies and grows by 2 after each game the player wins (down again when Mario
// wins), up to 6. The game ends when the side to move cannot move.

import { GameBase, bagPick } from "./base.js";
import { TABLES } from "../data/tables.js";
import { CMD } from "../ui/toolkit.js";

const rand15 = () => Math.floor(Math.random() * 32768);
const rnd100 = () => ((rand15() * 100) / 32768) | 0; // rand() * 100 / 32768

// ---------------------------------------------------------------- geometry (633c:00cb)
// The board is drawn in perspective. Each dark square has a piece anchor, a highlight frame
// (Pak 2500, numbered in reading order) and its screen position.
const ANCHOR_ROWS = [
  [[1, 79], [3, 144], [5, 208], [7, 272]],
  [[0, 43], [2, 109], [4, 176], [6, 242]],
  [[1, 74], [3, 143], [5, 211], [7, 279]],
  [[0, 36], [2, 106], [4, 177], [6, 248]],
  [[1, 69], [3, 142], [5, 214], [7, 286]],
  [[0, 29], [2, 103], [4, 178], [6, 253]],
  [[1, 64], [3, 141], [5, 217], [7, 293]],
  [[0, 28], [2, 101], [4, 179], [6, 257]],
];
const ANCHOR_Y = [104, 115, 126, 137, 148, 159, 170, 179];
const HILITE_ROWS = [
  [61, 127, 192, 256], [27, 92, 160, 225], [54, 124, 195, 262], [19, 89, 160, 229],
  [48, 121, 198, 268], [12, 85, 160, 233], [42, 118, 200, 275], [5, 82, 160, 236],
];
const HILITE_Y = [98, 109, 120, 131, 142, 153, 164, 176];
const PIECES = 2501, HILITES = 2500;

// Move animations (633c:03ea): group -> per direction [movie, dx, dy] from the source anchor.
// Directions (617d:0f95): 0 down-left, 1 down-right, 2 up-left, 3 up-right (rows grow downwards).
const ANIM = [
  [[2302, -40, -19], [2303, -11, -19], [2300, -43, -28], [2301, -6, -28]], // 0 Yoshi walk
  [[2310, -51, -28], [2311, -12, -28], [2308, -48, -40], [2309, -10, -40]], // 1 Yoshi over Koopa
  [[2314, -47, -36], [2315, -15, -36], [2312, -55, -49], [2313, -10, -49]], // 2 Yoshi over Bowser
  [[2306, -42, -32], [2307, -12, -32], [2304, -34, -43], [2305, -20, -43]], // 3 King Yoshi walk
  [[2318, -48, -36], [2319, -18, -36], [2316, -47, -42], [2317, -12, -42]], // 4 King Yoshi over Koopa
  [[2322, -46, -39], [2323, -20, -39], [2320, -49, -49], [2321, -17, -49]], // 5 King Yoshi over Bowser
  [[2002, -38, -23], [2003, -11, -23], [2000, -40, -31], [2001, -7, -31]], // 6 Koopa walk
  [[2010, -58, -35], [2011, -21, -35], [2008, -62, -47], [2009, -18, -47]], // 7 Koopa over Yoshi
  [[2014, -58, -42], [2015, -21, -42], [2012, -57, -55], [2013, -17, -55]], // 8 Koopa over King Yoshi
  [[2006, -49, -32], [2007, -18, -32], [2004, -55, -42], [2005, -13, -42]], // 9 Bowser walk
  [[2018, -60, -36], [2019, -21, -36], [2016, -58, -44], [2017, -14, -44]], // 10 Bowser over Yoshi
  [[2022, -59, -32], [2023, -19, -32], [2020, -58, -54], [2021, -16, -54]], // 11 Bowser over King Yoshi
];
// group for (mover type, victim type) (617d:0e49); types (617d:0de6): 0 Koopa, 1 Bowser,
// 2 Yoshi, 3 King Yoshi, 4 nothing
const GROUP = { 0: { 4: 6, 2: 7, 3: 8 }, 1: { 4: 9, 2: 10, 3: 11 }, 2: { 4: 0, 0: 1, 1: 2 }, 3: { 4: 3, 0: 4, 1: 5 } };

// phrase lists (DGROUP 0x1868..0x1988), indices into TABLES.checkers
const L_GREET = [4, 3, 2];
const L_YOUR_TURN = [11, 8, 9];
const L_PLAYER_WINS = [50, 51, 52, 53, 54, 55, 56, 57, 43, 45];
const L_MARIO_WINS = [48, 57, 47, 52, 46];
const L_THINKING = [34, 27, 40];
const L_FOUND = [36, 32, 33, 39];
const L_OUCH = [28, 29, 26, 27, 25, 24, 38, 37];
const L_MARIO_KING = [20, 23, 21, 22];
const L_MARIO_PIECE = [12, 14, 65, 66];
const L_PLAYER_KING = [18, 19, 41, 42, 15];
const L_ILLEGAL = [12, 67, 31];
const L_MUST_JUMP = [64, 63, 13];
const L_AGAIN = [59, 58];
const JOKES = [[75, 76, 79, 80, 81], [77, 78, 82, 83, 84], [75, 76, 85, 86, 87], [77, 78, 88, 89, 90]]; // 0x1c1c
const FIDGETS = [9002, 9000, 9001]; // 0x1c44

const NONE = 0xc8, SELECTED = 0xc9; // [0xdf4]
const EMPTY = 2; // cell owner when no piece; sides are 0 (Koopa art) and 1 (Yoshi art)

// ---------------------------------------------------------------- Mario's search (segment 1a5d)
// The 32 dark squares in reading order (0x17e8). Per square (DGROUP 0x1a12, 16 bytes): its column
// and row, the square one step away in each direction (0 up-left, 1 up-right, 2 down-left,
// 3 down-right), two steps away (directions 4-7, jumps) and the side crowned there. Pieces are
// coded side | 4 for a king; side 1 moves up (the player), side 2 down (Mario).
const SQUARES = [];
for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) if ((c + r) & 1) SQUARES.push([c, r]);
const sqAt = (c, r) => (c < 0 || c > 7 || r < 0 || r > 7 ? 0xff : SQUARES.findIndex(([x, y]) => x === c && y === r));
const DIRS = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
const STEP = SQUARES.map(([c, r]) => DIRS.map(([dc, dr]) => sqAt(c + dc, r + dr)));
const LEAP = SQUARES.map(([c, r]) => DIRS.map(([dc, dr]) => sqAt(c + 2 * dc, r + 2 * dr)));
const CROWN = SQUARES.map(([, r]) => (r === 0 ? 1 : r === 7 ? 2 : 0));
const DIR_SIDE = [1, 1, 2, 2, 1, 1, 2, 2]; // 0x1a0a: men of side 1 go up, of side 2 down
const newMove = () => ({ score: 0, cnt: 0, path: new Array(16).fill(0xff), dirs: new Array(16).fill(0) });

class Engine {
  constructor(codes, depth, forced, target) {
    this.b = codes; // 0x1a12 piece codes
    this.depth0 = depth; // [0x1c12]
    this.forced = forced; // [0x1c14]
    this.target = target; // [0x1c1a]: the square of the player's last move
  }
  copy(dst, src) {
    dst.score = src.score;
    dst.cnt = src.cnt;
    dst.path = src.path.slice();
    dst.dirs = src.dirs.slice();
  }
  coin() {
    return ((rand15() << 8) / 32768 | 0) > 127; // ties are broken at random
  }
  // 004f: the best move for `side` searching `depth` plies, into res
  search(side, res, depth) {
    res.cnt = 0;
    res.path[0] = res.path[1] = 0xff;
    res.score = 0;
    if (depth <= 0) return 0;
    let found = 0;
    for (let sq = 0; sq < 32; sq++) {
      if ((this.b[sq] & 3) !== side) continue;
      const tmp = newMove();
      tmp.path[0] = sq;
      if (this.jumps(side, tmp, res, depth)) found = 1;
    }
    if (!(found && this.forced))
      for (let sq = 0; sq < 32; sq++) {
        if ((this.b[sq] & 3) !== side) continue;
        for (let dir = 0; dir < 4; dir++) {
          const tmp = newMove();
          tmp.path[0] = sq;
          if (!this.extend(side, tmp, dir)) continue;
          this.evaluate(side, tmp, depth);
          if (!found || res.score < tmp.score || (res.score === tmp.score && this.coin())) {
            found = 1;
            this.copy(res, tmp);
          }
          this.pop(tmp);
        }
      }
    if (!found) res.score = -100;
    return found;
  }
  // 01d6: every jump sequence from tmp's piece; returns how many jumps were possible here
  jumps(side, tmp, best, depth) {
    let count = 0;
    if (depth <= 0) return 0;
    let had = best.path[0] !== 0xff && best.path[1] !== 0xff; // not refreshed after deeper calls (sic)
    for (let dir = 4; dir < 8; dir++) {
      if (!this.extend(side, tmp, dir)) continue;
      count++;
      if (!(this.jumps(side, tmp, best, depth) && this.forced)) {
        this.evaluate(side, tmp, depth);
        if (!had || tmp.score > best.score || (tmp.score === best.score && this.coin())) {
          had = true;
          this.copy(best, tmp);
        }
      }
      this.pop(tmp);
    }
    return count;
  }
  // 06e2: add a step (directions 0-3) or a jump (4-7) to the move; the whole jump chain is
  // re-checked from the start, with the piece still standing on its first square
  extend(side, mv, dir) {
    const from = mv.path[0], piece = this.b[from];
    if ((piece & 3) !== side || (DIR_SIDE[dir] !== side && !(piece & 4))) return 0;
    if (dir < 4) {
      const to = STEP[from][dir];
      if (to === 0xff || this.b[to]) return 0;
      mv.path[1] = to;
      mv.dirs[1] = dir;
      return 1;
    }
    const n = ++mv.cnt;
    mv.dirs[n] = dir;
    mv.path[n] = mv.path[n - 1] === 0xff ? 0xff : LEAP[mv.path[n - 1]][dir - 4];
    let ok = 1, cur = from;
    const taken = [];
    for (let k = 0; k < n; k++) {
      const d = mv.dirs[k + 1] - 4;
      const land = LEAP[cur][d], over = STEP[cur][d];
      if (land === 0xff || this.b[land] || (this.b[over] & 3) !== (side ^ 3)) {
        ok = 0;
        break;
      }
      taken.push([over, this.b[over]]);
      this.b[over] = 0;
      cur = land;
    }
    while (taken.length) {
      const [sq, code] = taken.pop();
      this.b[sq] = code;
    }
    this.b[from] = piece;
    if (!ok) mv.path[mv.cnt--] = 0xff;
    return ok;
  }
  pop(mv) {
    if (mv.cnt) mv.path[mv.cnt--] = 0xff; // 08bb
    else mv.path[1] = 0xff;
  }
  // 0568: does the move end strictly closer to t, in both columns and rows?
  closer(a, b, t) {
    const [ax, ay] = SQUARES[a], [bx, by] = SQUARES[b], [tx, ty] = SQUARES[t];
    return Math.abs(ax - tx) > Math.abs(bx - tx) && Math.abs(ay - ty) > Math.abs(by - ty);
  }
  // 0501: 300 when the other side has nothing left
  material(side) {
    const opp = side ^ 3;
    for (let sq = 0; sq < 32; sq++) if ((this.b[sq] & 3) === opp) return 0;
    return 300;
  }
  // 02ba: play the move on the board and score it: 2 per capture (+2 for a king), 4 for a crown,
  // +1 at the top level for ending closer to the player's last move, 300 for a win, minus the
  // best reply; then take it back
  evaluate(side, mv, depth) {
    const b = this.b;
    mv.score = 0;
    const from = mv.path[0], piece = b[from];
    b[from] = 0;
    let land;
    const taken = [];
    if (mv.dirs[1] >= 4 && mv.dirs[1] <= 7) {
      const n = mv.cnt;
      mv.score += n * 2;
      let cur = from;
      for (let k = 0; k < n; k++) {
        const d = mv.dirs[k + 1] - 4;
        land = LEAP[cur][d];
        const over = STEP[cur][d];
        if (b[over] & 4) mv.score += 2;
        taken.push([over, b[over]]);
        b[over] = 0;
        cur = land;
      }
    } else land = STEP[from][mv.dirs[1]];
    b[land] = piece;
    if (!(piece & 4) && CROWN[land] === side) {
      mv.score += 4;
      b[land] |= 4;
    }
    if (depth === this.depth0 && this.target !== 0xff && this.closer(from, land, this.target)) mv.score++;
    const won = this.material(side);
    mv.score += won;
    if (won === 300) mv.score = 300;
    else if (depth - 1 !== 0) {
      const reply = newMove();
      if (this.search(side ^ 3, reply, depth - 1)) {
        const has = reply.path[0] !== 0xff && reply.path[1] !== 0xff;
        if (has && reply.score === 300) mv.score = -300;
        else if (has && reply.score === -300) mv.score = 300;
        else mv.score -= reply.score;
      }
    }
    b[from] = piece;
    for (const [sq, code] of taken) b[sq] = code;
    b[mv.cnt && mv.dirs[1] >= 4 ? mv.path[mv.cnt] : mv.path[1]] = 0;
  }
}

// ---------------------------------------------------------------- state outliving one game
// The data segment keeps Mario's search depth and the last result for the whole run; entering
// Checkers from the menu (7000:0033-style init, 6000:0033 here) resets the win counters, the idle
// timer, the jokes and the replay pacing; New Game / Play Again only restart the game flow.
const run = { depth: 1, depthTarget: 1, result: 0, searchMs: 0, target: [0, 0] }; // [0xdec] [0xdee] [0x6414] [0x6448] [0x6462]/[0x6460]
let sess = null;

function newSession() {
  return {
    winsP: 0, winsM: 0, // [0x6456] [0x6458]
    replaySt: 0, replayCnt: 0, // [0x6410] [0x6412]
    idleAt: 120, joke: 4, // [0xe02] [0x743e]
    blinkSt: 0, blinkAt: 20 + (((rand15() * 70) / 32768) | 0), blinkT: 0, // [0x7434] [0x7436] [0x7438]
    cells: null,
    sides: { mario: 2, down: 1, up: 0 }, // [0xde8] [0x1c6c] [0x1c6e]
  };
}

function emptyCells() {
  const cells = [];
  let hi = 0;
  for (let c = 0; c < 8; c++) cells.push([]);
  for (let r = 0; r < 8; r++)
    for (let c = 0; c < 8; c++) {
      const play = (c + r) & 1;
      const cell = { play, owner: EMPTY, king: 0, path: 0, lit: 0, gone: 0, blink: 0, facing: 0 };
      if (play) {
        const i = ANCHOR_ROWS[r].findIndex(([x]) => x === c);
        Object.assign(cell, { ax: ANCHOR_ROWS[r][i][1], ay: ANCHOR_Y[r], hx: HILITE_ROWS[r][i], hy: HILITE_Y[r], frame: hi++ });
      }
      cells[c][r] = cell;
    }
  return cells;
}

// ---------------------------------------------------------------- intro (overlay 659c)
class CheckersIntro {
  constructor(next) {
    this.next = next;
  }
  enter() {
    const e = this.e;
    e.setPalette(1000);
    if (e.menubar) e.menubar.visible = false;
    this.yoshi = e.movie(2801);
    this.koopa = e.movie(2800);
    for (const m of [this.yoshi, this.koopa]) {
      m.x = -93;
      m.y = 144;
    }
    this.count = 10; // [0x1d02]
  }
  go() {
    if (this.gone) return;
    this.gone = true;
    if (this.e.menubar) this.e.menubar.visible = true;
    this.e.setScene(this.next);
  }
  tick() {
    this.koopa.sounds();
    this.yoshi.advanceOnce();
    this.koopa.advanceOnce();
    if (this.count === 10) this.e.audio.playMusic(142, false);
    if (this.count > 0) this.count--;
    if (this.count < 1 && this.yoshi.done) this.go();
  }
  render(s) {
    s.clear(0);
    this.e.gfx.bg(2998);
    this.yoshi.draw();
    this.koopa.draw();
  }
  // only a key skips this intro: it has no mouse handler
  key() {
    this.go();
  }
}

// ---------------------------------------------------------------- the game
export default class Checkers extends GameBase {
  constructor(opts = {}) {
    super();
    this.opts = opts;
  }
  enter() {
    if (!this.opts.skipIntro && !this.introDone) {
      this.introDone = true;
      sess = newSession();
      return this.e.setScene(new CheckersIntro(this));
    }
    if (!sess) sess = newSession();
    this.init();
  }
  // 6000:0033 (+ 633c:001a / 008a): resources, talking head, empty board, then 0b0b(0)
  init() {
    this.setup({
      bg: 2999,
      talker: { base: 11000, x: 132, y: 14 },
      captionFont: 224,
      captionRect: { l: 1, t: 191, r: 320, b: 200 },
      table: TABLES.checkers,
    });
    this.sp.create(111, 53, 2505, 0, 0x66); // Mario's body
    if (!sess.cells) sess.cells = emptyCells();
    this.cells = sess.cells;
    this.sides = sess.sides;
    this.flags = 0; // [0x662e]
    this.over = 1; // [0xdf6]
    this.sel = NONE;
    this.forced = this.e.prefs.forcedJumps !== false; // [0x19a0]
    this.idle = 0; // [0xdfa]
    this.animMv = null; // [0x19b4]
    this.celebMv = null; // [0x19b6]
    this.fidgetMv = null; // [0x19b2]
    this.moves = [];
    this.moveIdx = 0; // [0x65f6] / [0x65f8]
    this.searchOK = 0; // [0x645a]
    this.toMove = 1; // [0x1c6a]
    this.mode = 0x130; // [0xdea]
    this.ist = 0; // 617d:08de
    this.resetCont();
    this.input(0, -1, -1);
    this.stepDriver(0);
    this.jumpDriver(0);
    this.stepAnim(0);
    this.jumpAnim(0);
    this.startFlow(0);
    this.ready = true;
  }

  // ---------------------------------------------------------------- small helpers
  cell(c, r) {
    return this.cells[c][r];
  }
  talking() {
    return this.talker.talking;
  }
  hideHead() {
    this.talker.hidden = true; // 1aec:03c0
    this.sp.hide(0x66);
  }
  resetHead() {
    this.talker.idle(); // 1aec:032a
    this.talker.hidden = false;
    this.sp.show(0x66);
  }
  say(i) {
    this.talker.hidden = false;
    this.sp.show(0x66);
    return super.say(i);
  }
  sayRandom(list) {
    return this.say(bagPick(list));
  }
  caption(text) {
    return this.talker.sayText(0, text); // 1aec:005a with no movie: caption only
  }
  // 617d:00aa marks a square for redrawing (flag 4); the redraw at the start of the next tick
  // clears it, so the routines that wait on it lose a tick
  inval() {
    this.flags |= 4;
  }
  modal(promise, then) {
    this.inModal = true;
    promise.then((v) => {
      this.inModal = false;
      this.idle = 0;
      if (then) then(v);
    });
  }
  // 6000:1300 / 1344 / 1388
  thinking() {
    if (!this.talking() && rnd100() > 50) this.sayRandom(L_THINKING);
  }
  ouch() {
    if (!this.talking() && rnd100() < 70) this.sayRandom(L_OUCH);
  }
  crowned(mario) {
    if (!this.talking()) this.sayRandom(mario ? L_MARIO_KING : L_PLAYER_KING);
  }

  // ---------------------------------------------------------------- 6000:0b0b: game start and end
  startFlow(arg) {
    if (arg === 0) {
      this.searchOK = 1;
      this.flags |= 0x200;
      this.st = 3;
      this.cnt = 4;
      return;
    }
    switch (this.st) {
      case 3:
        if (this.cnt-- > 0) return;
        this.st = 0;
        return;
      case 0:
        this.over = 0;
        this.mode = 0x130;
        this.celebMv = null;
        this.clearPath();
        this.sayRandom(L_GREET);
        this.st = 1;
        return;
      case 1:
        if (this.talking()) return;
        this.say(72); // "Do you want to play as a Yoshi, or as a Koopa?"
        this.idle = 0;
        this.st = 2;
        return;
      case 2:
        if (this.talking()) return;
        this.cnt = 5;
        this.st = this.e.app && !this.e.app.nameAsked ? 4 : 5;
        // 02a3: the side the player picked; Mario plays the other one from the top
        this.modal(this.dlgPlayAs(), (v) => {
          const s = this.sides;
          s.mario = v === "yoshi" ? 0 : 1;
          s.down = s.mario;
          s.up = s.mario === 0 ? 1 : 0;
        });
        return;
      case 4:
        this.st = 5;
        if (this.e.app) {
          this.e.app.nameAsked = true;
          this.modal(this.e.app.askName());
        }
        return;
      case 5: {
        if (this.cnt-- > 0) return;
        this.say(rnd100() > 50 ? 11 : 6); // "It's your turn." / "You go first."
        const s = this.sides;
        if (s.mario === 2) s.mario = 0;
        this.idle = 0;
        this.toMove = s.mario === 0 ? 1 : 0;
        this.sp.create(11, 29, PIECES, s.mario === 0 ? 13 : 12, 0x64); // name plates
        this.sp.create(286, 29, PIECES, s.mario === 0 ? 12 : 13, 0x65);
        this.flags |= 1;
        this.flags &= ~2;
        this.flags &= ~0x200;
        this.sel = NONE;
        this.input(0, -1, -1);
        this.turnChanged();
        this.clearPath();
        this.newBoard();
        this.adjustDepthTarget();
        this.adjustDepth();
        this.modeCmd(this.mode);
        this.st = 6;
        return;
      }
      case 6: {
        if (!this.over) return;
        let mine = 0, theirs = 0;
        for (const [c, r] of SQUARES) {
          const o = this.cell(c, r).owner;
          if (o === EMPTY) continue;
          if (o === this.sides.mario) mine++;
          else theirs++;
        }
        if (!this.searchOK && mine > 0) {
          run.result = 0x98;
          this.st = 12; // "I'm stuck!"
          return;
        }
        this.flags &= ~1;
        this.flags &= ~2;
        this.sel = NONE;
        if (!mine) {
          run.result = 0x96;
          sess.winsP++;
          this.st = 7;
        } else if (!theirs) {
          run.result = 0x97;
          sess.winsM++;
          this.st = 11;
        } else {
          run.result = 0x98; // the player is blocked: no word about who won (sic)
          this.st = 13;
        }
        this.cnt = 5;
        return;
      }
      case 7:
        if (this.talking()) return;
        if (this.cnt-- > 0) return;
        this.sayRandom(L_PLAYER_WINS);
        this.rc = [0, 0];
        this.st = 8;
        return;
      case 8: {
        // the pieces leave the board one per tick (row by row), each with a tap
        if (this.talking()) return;
        for (;;) {
          const [c, r] = this.rc, cl = this.cell(c, r);
          let moved = false;
          if (cl.owner !== EMPTY) {
            this.inval();
            cl.gone = 1;
            moved = true;
          }
          if (moved && !this.talking()) this.e.audio.playSnd(5003);
          this.rc[0]++;
          if (this.rc[0] === 8) {
            this.rc[0] = 0;
            if (++this.rc[1] === 8) {
              this.st = 9;
              return;
            }
          }
          if (moved) return;
        }
      }
      case 9: {
        const m = (this.celebMv = this.e.movie(2996));
        m.x = 117;
        m.y = 102;
        this.e.audio.playMusic(143, false);
        this.st = 10;
        return;
      }
      case 10:
        if (this.celebMv && !this.celebMv.done) return;
        this.celebMv = null;
        this.st = 13;
        this.cnt = 6;
        return;
      case 11:
        if (this.talking()) return;
        if (sess.winsM === 1) this.say(48); // "I won!"
        else this.sayRandom(L_MARIO_WINS);
        this.cnt = 6;
        this.st = 13;
        return;
      case 12:
        this.say(49); // "I'm stuck!"
        this.cnt = 6;
        this.st = 13;
        return;
      case 13:
        if (this.talking()) return;
        if (this.cnt-- < 1) return; // goes on at once: the countdown test is the wrong way round (sic)
        this.sayRandom(L_AGAIN);
        this.st = 14;
        return;
      case 14:
        if (this.talking()) return;
        this.st = 3;
        this.cnt = 4;
        this.modal(this.dlgPlayAgain(), (yes) => (yes ? this.restart() : this.e.app.mainMenu(true)));
        return;
    }
  }
  // 13ab: Mario plays deeper after the player wins, shallower otherwise (1..6, even above 1),
  // then 0x137 sets the search depth to that rounded up to even
  adjustDepthTarget() {
    run.depthTarget += run.result === 0x96 ? 2 : -2;
    if (run.depthTarget < 1) run.depthTarget = 1;
    else if (run.depthTarget > 6) run.depthTarget = 6;
    if (run.depthTarget > 1) run.depthTarget -= run.depthTarget % 2;
    run.depth = run.depthTarget + (run.depthTarget % 2);
  }
  // 1411: with a king on a board of fewer than 4 pieces he looks 6 plies ahead; never below the
  // target, never above 6
  adjustDepth() {
    let pieces = 0, king = false;
    for (const [c, r] of SQUARES) {
      const cl = this.cell(c, r);
      if (cl.owner === EMPTY) continue;
      pieces++;
      if (cl.king) king = true;
    }
    let d = run.depth;
    if (king && pieces < 4) d = 6;
    if (d < run.depthTarget) d = run.depthTarget;
    else if (d > 6) d = 6;
    if (d !== run.depth) {
      run.depth = d;
      if (run.depth > 1) run.depth -= run.depth % 2;
    }
  }
  // 0x5c6: play mode 0x130 is Mario against the player
  modeCmd(cmd) {
    if (cmd === 0x130) this.sides.mario = this.sides.down;
    this.mode = cmd;
    this.turnChanged();
    if (this.sides.mario === this.toMove && cmd !== 0x131) {
      this.clearPath();
      this.marioSearch();
    }
  }
  // 0850 + 0fdb: a fresh board, Mario's men on the three top rows facing us
  newBoard() {
    this.moves = [];
    this.moveIdx = 0;
    for (let c = 0; c < 8; c++)
      for (let r = 0; r < 8; r++) Object.assign(this.cells[c][r], { owner: EMPTY, lit: 0, king: 0, path: 0, gone: 0, blink: 0 });
    const { down, up } = this.sides;
    for (let c = 0; c < 8; c++)
      for (let r = 0; r < 8; r++) {
        if (!((c + r) & 1)) continue;
        if (r <= 2) Object.assign(this.cells[c][r], { owner: down, facing: 0 });
        if (r >= 5) Object.assign(this.cells[c][r], { owner: up, facing: 1 });
      }
    this.over = 0;
    this.sel = NONE;
    this.turnChanged();
  }

  // ---------------------------------------------------------------- 0xc1d: whose turn it is
  turnChanged() {
    this.idle = 0;
    if (this.over) return;
    this.adjustDepth();
    if (this.mode !== 0x130) return this.caption(this.toMove === 1 ? "Yoshi's Move!" : "Koopa's Move!");
    if (this.toMove === this.sides.mario) {
      this.flags |= 2;
      this.flags &= ~1;
      if (this.talking()) return;
      if (rnd100() < 70) this.caption("It's Mario's move.");
      else this.say(10); // "It's my turn now."
    } else {
      this.flags |= 1;
      this.flags &= ~2;
      if (this.talking()) return;
      if (rnd100() < 75) this.caption("It's your move.");
      else this.sayRandom(L_YOUR_TURN);
    }
  }
  // 0xc1e: Mario looks for his move (6000:1628 -> 1a5d:000d)
  marioSearch() {
    this.adjustDepth();
    if (run.searchMs > 60000) run.depth = Math.max(1, run.depth - 2);
    const t0 = performance.now();
    const side = this.sides.mario;
    const codes = new Uint8Array(32);
    SQUARES.forEach(([c, r], i) => {
      const cl = this.cell(c, r);
      if (cl.owner === EMPTY) return;
      codes[i] = (cl.owner === side ? 2 : 1) | (cl.king ? 4 : 0);
    });
    const [tc, tr] = run.target;
    const eng = new Engine(codes, run.depth, 1, (tr * 8 + tc) >> 1); // always with forced jumps (sic)
    const best = newMove();
    this.searchOK = 1;
    this.moves = [];
    if (eng.search(2, best, run.depth)) {
      const n = best.path[0] !== 0xff && best.path[1] !== 0xff ? best.cnt || 1 : 0;
      for (let k = 0; k <= n; k++) this.moves.push(SQUARES[best.path[k]]);
    } else {
      this.searchOK = 0;
      this.over = 1;
    }
    run.searchMs = performance.now() - t0;
    this.moveIdx = 0;
  }
  // 6000:14ae: Mario clicks his squares like the player would, a few ticks apart. The long
  // pause before the first click only happens once per visit (sic: later turns start in state 1)
  replay() {
    if (this.over) return;
    const S = sess;
    for (;;) {
      switch (S.replaySt) {
        case 0:
          if (this.moveIdx >= this.moves.length || this.talking()) return;
          this.say(1);
          S.replayCnt = 10;
          if (rnd100() > 85) {
            S.replaySt = 1;
            continue;
          }
          this.thinking();
          S.replayCnt = (((rand15() << 3) / 32768) | 0) + 10;
          S.replaySt = 1;
          return;
        case 1:
          if (this.moveIdx >= this.moves.length || this.talking()) return;
          if (S.replayCnt-- > 0) return;
          {
            const [c, r] = this.moves[this.moveIdx++];
            this.input(1, c, r);
          }
          S.replayCnt = 4;
          S.replaySt = 2;
          return;
        case 2:
          if (S.replayCnt-- > 0) return;
          if (this.flags & (0x10 | 0x40 | 8 | 4 | 0x20)) return;
          S.replayCnt = 4;
          S.replaySt = this.moveIdx >= this.moves.length ? 3 : 1;
          return;
        case 3:
          this.say(1);
          S.replayCnt = 4;
          S.replaySt = 1;
          return;
        default:
          S.replayCnt = 4;
          S.replaySt = 1;
          return;
      }
    }
  }

  // ---------------------------------------------------------------- 63e7: move input and rules
  // 0000: a dark square?
  dark(c, r) {
    return (c + r) % 2 === 1;
  }
  // 12ef: how many squares of the move have been clicked; 1371: the k-th one
  pathLen() {
    let n = -1;
    for (const [c, r] of SQUARES) n = Math.max(n, this.cell(c, r).path);
    return n;
  }
  pathAt(k) {
    let at = [-1, -1];
    for (const [c, r] of SQUARES) if (this.cell(c, r).path === k) at = [c, r];
    return at;
  }
  startIsKing() {
    for (const [c, r] of SQUARES) if (this.cell(c, r).path === 1 && this.cell(c, r).king === 1) return 1; // 1ab8
    return 0;
  }
  owner(c, r) {
    return c < 0 || c > 7 || r < 0 || r > 7 ? -1 : this.cell(c, r).owner;
  }
  // 003e: can `side` make a plain step anywhere? 0230: a jump?
  canStep(side) {
    for (const [c, r] of SQUARES) {
      const cl = this.cell(c, r);
      if (cl.owner !== side) continue;
      if (this.sides.down === side || cl.king) {
        if (r + 1 < 8 && c + 1 < 8 && this.owner(c + 1, r + 1) === EMPTY) return 1;
        if (r + 1 < 8 && c - 1 >= 0 && this.owner(c - 1, r + 1) === EMPTY) return 1;
      }
      if (this.sides.up === side || cl.king) {
        if (r - 1 >= 0 && c + 1 < 8 && this.owner(c + 1, r - 1) === EMPTY) return 1;
        if (r - 1 >= 0 && c - 1 >= 0 && this.owner(c - 1, r - 1) === EMPTY) return 1;
      }
    }
    return 0;
  }
  canJump(side) {
    const opp = side === 0 ? 1 : 0;
    for (const [c, r] of SQUARES) {
      const cl = this.cell(c, r);
      if (cl.owner !== side) continue;
      const tries = [];
      if (this.sides.down === side || cl.king) tries.push([1, 1], [-1, 1]);
      if (this.sides.up === side || cl.king) tries.push([1, -1], [-1, -1]);
      for (const [dc, dr] of tries) {
        const tc = c + 2 * dc, tr = r + 2 * dr;
        if (tc < 0 || tc > 7 || tr < 0 || tr > 7) continue;
        if (this.owner(c + dc, r + dr) === opp && this.owner(tc, tr) === EMPTY) return 1;
      }
    }
    return 0;
  }
  // 056c: the side to move is stuck -> game over
  blocked() {
    if (!this.canJump(this.toMove) && !this.canStep(this.toMove)) {
      this.over = 1;
      return 1;
    }
    return 0;
  }
  // 11dc: the clicked pair is a plain step forward (either way for a king)
  legalStep() {
    const [c1, r1] = this.pathAt(1), [c2, r2] = this.pathAt(2);
    if (c1 < 0 || r1 < 0 || c2 < 0 || r2 < 0) {
      this.caption("Error0  in bLegalMove; Internal Error");
      return 0;
    }
    const king = this.startIsKing();
    if ((this.toMove === this.sides.up || king) && r1 - 1 === r2 && (c1 + 1 === c2 || c1 - 1 === c2)) return 1;
    if ((this.toMove === this.sides.down || king) && r1 + 1 === r2 && (c1 + 1 === c2 || c1 - 1 === c2)) return 1;
    this.sayRandom(L_ILLEGAL);
    return 0;
  }
  // 13e9: one jump from (c1,r1) to (c2,r2) for `side`; the captured pieces stay on the board
  // while the move is being clicked, so they are never re-checked (sic)
  legalJump(c1, r1, c2, r2, side) {
    if (c1 < 0 || r1 < 0 || c2 < 0 || r2 < 0 || c1 > 7 || r1 > 7 || c2 > 7 || r2 > 7) return 0;
    const king = this.startIsKing(), opp = side === 0 ? 1 : 0;
    const ok = (dc, dr) => c2 === c1 + 2 * dc && r2 === r1 + 2 * dr && this.owner(c1 + dc, r1 + dr) === opp && this.owner(c2, r2) === EMPTY;
    if ((this.sides.down === side || king) && (ok(1, 1) || ok(-1, 1))) return 1;
    if ((this.sides.up === side || king) && (ok(1, -1) || ok(-1, -1))) return 1;
    return 0;
  }
  // 15ad: every clicked pair is a jump
  isJumpPath() {
    const n = this.pathLen();
    if (n <= 0) {
      this.caption("Error1  in bMoveIsJump; Internal Error");
      return 0;
    }
    for (let k = 1; k < n; k++) {
      const [c1, r1] = this.pathAt(k), [c2, r2] = this.pathAt(k + 1);
      if (!this.legalJump(c1, r1, c2, r2, this.toMove)) return 0;
    }
    return 1;
  }
  // 1623: already part of the clicked path (before its last square)
  inPath(c, r) {
    if (c < 0 || c > 7 || r < 0 || r > 7) return 0;
    const p = this.cell(c, r).path;
    return p > 0 && p < this.pathLen() ? 1 : 0;
  }
  // 166d: the jump path cannot go on from its last square
  jumpDone(side) {
    const n = this.pathLen();
    if (n < 2) {
      this.caption("Error1  in bJumpIsComp; Internal Error");
      return 0;
    }
    const [c, r] = this.pathAt(n);
    if (c < 0 || r < 0) return 0;
    const more = (dc, dr) => !this.inPath(c + 2 * dc, r + 2 * dr) && this.legalJump(c, r, c + 2 * dc, r + 2 * dr, side);
    if (!this.startIsKing()) {
      if (this.sides.down === side && (more(1, 1) || more(-1, 1))) return 0;
      if (this.sides.up !== side) return 1;
      if (more(1, -1) || more(-1, -1)) return 0;
      return 1;
    }
    if (more(1, 1) || more(-1, 1) || more(1, -1) || more(-1, -1)) return 0;
    return 1;
  }
  // 18c8 / 18df: is the clicked move complete?
  resetCont() {
    this.contAt = [-1, -1]; // [0x7488]/[0x7486]
    this.cont = 0; // [0x1c70]
  }
  moveComplete(c, r) {
    if (this.cont) {
      if (c === this.contAt[0] && r === this.contAt[1]) {
        this.cell(c, r).path--; // clicked the last square again: stop the jump there
        return 1;
      }
      this.cont = 0;
    }
    if (this.sel !== SELECTED) return 0;
    if (!this.canJump(this.toMove)) {
      this.cont = 0;
      if (this.legalStep()) return 1;
      this.clearPath();
      return 0;
    }
    if (this.forced) {
      if (!this.isJumpPath()) {
        this.sayRandom(L_MUST_JUMP);
        this.clearPath();
        return 0;
      }
      return this.jumpDone(this.toMove) ? 1 : 0;
    }
    if (!this.isJumpPath()) {
      this.cont = 0;
      if (this.legalStep()) return 1;
      this.clearPath();
      return 0;
    }
    this.cont = 0;
    if (this.jumpDone(this.toMove)) return 1;
    this.contAt = [c, r];
    if (this.toMove !== this.sides.mario) this.say(62); // "Click where you want to go."
    this.cont = 1;
    return 0;
  }
  // 1120 / 1188: forget the clicked squares (1188 redraws every square, 1120 the lit ones)
  clearPath(all = false) {
    for (const [c, r] of SQUARES) {
      const cl = this.cell(c, r);
      if (cl.lit || all) this.inval();
      cl.lit = 0;
      cl.path = 0;
    }
    this.sel = NONE;
    this.resetCont();
  }
  // 088d: a click on (c, r) by the player or by Mario; (-1, -1) is the per-tick call
  input(arg, c, r) {
    if (arg === 0) {
      this.ist2 = 0; // [0x7462]
      return;
    }
    if (this.over) return;
    const tickOnly = c === -1 && r === -1;
    if (!tickOnly && !this.dark(c, r)) return;
    switch (this.ist2) {
      case 0: {
        if (tickOnly) return;
        const cl = this.cell(c, r);
        if (cl.owner !== this.toMove && cl.owner !== EMPTY) return void this.sayRandom(L_MARIO_PIECE);
        if (cl.owner === EMPTY && this.sel === NONE) return void this.sayRandom(L_ILLEGAL);
        if (cl.owner === this.toMove) {
          if (this.sel === SELECTED) this.clearPath();
          this.sel = SELECTED;
          cl.path = 1;
          cl.lit = 1;
          this.inval();
          return;
        }
        if (cl.owner !== EMPTY || this.sel !== SELECTED) return;
        cl.lit = 1;
        cl.path = this.pathLen() + 1;
        this.inval();
        if (!this.moveComplete(c, r)) return;
        this.ist2 = 1;
        if (this.sides.mario !== this.toMove || this.talking()) return;
        if (rnd100() < 50) this.sayRandom(L_FOUND);
        return;
      }
      case 1: {
        if (this.talking() || this.flags & 4) return;
        run.target = this.pathAt(this.pathLen());
        if (!this.isJumpPath()) this.flags |= 8;
        else {
          this.jumpDriver(0);
          this.flags |= 0x10;
        }
        this.ist2 = 2;
        return;
      }
      case 2:
        this.idle = 0;
        if (this.flags & (0x10 | 0x40 | 8 | 4 | 0x20)) return;
        this.clearPath(true);
        this.say(1);
        this.ist2 = 3;
        return;
      case 3:
        this.toMove = this.toMove === 0 ? 1 : 0;
        if (this.blocked()) {
          this.over = 1;
          this.clearPath();
          return;
        }
        this.turnChanged();
        if (this.toMove === this.sides.mario && !this.over) {
          this.thinking();
          this.ist2 = 4;
          return;
        }
        this.ist2 = 0;
        return;
      case 4:
        if (this.talking()) return;
        this.marioSearch();
        this.ist2 = 0;
        return;
      default:
        this.ist2 = 0;
    }
  }

  // ---------------------------------------------------------------- 63e7:0bdd / 0d73: playing the move
  stepDriver(arg) {
    if (arg === 0) {
      this.flags &= ~8;
      this.sdSt = 0;
      return;
    }
    if (this.sdSt === 0) {
      if (this.sel !== SELECTED) return;
      this.flags |= 8;
      const [c1, r1] = this.pathAt(1), [c2, r2] = this.pathAt(2);
      this.sd = { c1, r1, c2, r2, king: this.cell(c1, r1).king };
      this.sd.crown = !this.sd.king && (r2 === 0 || r2 === 7);
      this.stepAnim(0);
      this.stepAnim(1, c1, r1, c2, r2);
      this.sdSt = 1;
      return;
    }
    if (this.flags & 4 || this.flags & 0x20) return;
    const { c1, r1, c2, r2, crown } = this.sd;
    if (crown && (r2 === 0 || r2 === 7)) {
      const cl = this.cell(c2, r2);
      cl.king = 1;
      this.crowned(cl.owner === this.sides.mario);
    }
    // the facing is set on the square the piece came from (sic)
    if (r2 === 0) this.cell(c1, r1).facing = 0;
    else if (r2 === 7) this.cell(c1, r1).facing = 1;
    this.flags &= ~8;
    this.sdSt = 0;
  }
  jumpDriver(arg) {
    if (arg === 0) {
      this.jdSt = 0;
      this.flags &= ~0x10;
      return;
    }
    switch (this.jdSt) {
      case 0: {
        this.jdK = 1; // [0x7482]
        this.flags |= 0x10;
        this.jdN = this.pathLen();
        if (!this.jdN) {
          this.flags &= ~0x10;
          return;
        }
        const [c, r] = this.pathAt(1);
        this.jdKing = this.cell(c, r).king;
        this.jdSt = 1;
        return;
      }
      case 1: {
        if (this.jdK >= this.jdN) {
          this.jdSt = 3;
          return;
        }
        if (this.flags & 4) return;
        const [c1, r1] = this.pathAt(this.jdK), [c2, r2] = this.pathAt(this.jdK + 1);
        if (c1 < 0 || r1 < 0 || c2 < 0 || r2 < 0) {
          this.jdSt = 3;
          return;
        }
        this.jd = { c1, r1, c2, r2 };
        const jr = r1 > r2 ? r2 + 1 : r2 - 1, jc = c1 > c2 ? c2 + 1 : c2 - 1;
        this.inval();
        this.jumpAnim(0);
        this.jumpAnim(1, c1, r1, jc, jr, c2, r2);
        this.jdK++;
        this.jdSt = 2;
        return;
      }
      case 2: {
        if (this.flags & 0x40) return;
        const { c2, r2 } = this.jd;
        if (!this.jdKing && (r2 === 0 || r2 === 7)) {
          const cl = this.cell(c2, r2);
          cl.king = 1;
          this.jdKing = 1;
          this.crowned(cl.owner === this.sides.mario);
        }
        this.jdSt = 1;
        return;
      }
      case 3:
        if (this.flags & 0x40) return;
        this.inval();
        this.flags &= ~0x10;
        return;
    }
  }

  // ---------------------------------------------------------------- 617d: animations
  pieceType(c, r) {
    const cl = this.cell(c, r); // 0de6
    if (cl.owner === 0) return cl.king ? 1 : 0;
    if (cl.owner === 1) return cl.king ? 3 : 2;
    return 4;
  }
  dirOf(c1, r1, c2, r2) {
    if (c1 > c2 && r1 > r2) return 2;
    if (c1 < c2 && r1 > r2) return 3;
    if (c1 > c2 && r1 < r2) return 0;
    return 1;
  }
  // 0e49 + MovOpen: the movie for the mover on (c1,r1) going towards (c2,r2), placed on its anchor
  openAnim(c1, r1, c2, r2, dir) {
    const g = (GROUP[this.pieceType(c1, r1)] || {})[this.pieceType(c2, r2)];
    if (g === undefined || !this.e.prs.has("MuV", ANIM[g][dir][0])) return null;
    const [id, dx, dy] = ANIM[g][dir];
    const m = this.e.movie(id);
    const a = this.cell(c1, r1);
    m.x += a.ax + dx;
    m.y += a.ay + dy;
    return m;
  }
  put(c, r, owner, king) {
    Object.assign(this.cell(c, r), { owner, king });
    this.inval();
  }
  land(c, r, dir) {
    const cl = this.cell(c, r); // facing after a move: by the row reached, else by the direction
    cl.facing = r === 0 ? 0 : r === 7 ? 1 : dir === 2 || dir === 3 ? 1 : 0;
    this.idle = 0;
  }
  // 0f95: a plain step
  stepAnim(arg, c1, r1, c2, r2) {
    if (arg === 0) {
      this.flags &= ~0x20;
      this.sa = null;
      this.saSt = 0;
      return;
    }
    if (this.saSt === 0) {
      this.flags |= 0x20;
      const dir = this.dirOf(c1, r1, c2, r2);
      const from = this.cell(c1, r1);
      this.sa = { c1, r1, c2, r2, dir, owner: from.owner, king: from.king };
      const m = this.openAnim(c1, r1, c2, r2, dir);
      this.put(c1, r1, EMPTY, 0);
      this.put(c2, r2, EMPTY, 0);
      if (!m) {
        this.put(c2, r2, this.sa.owner, this.sa.king);
        this.flags &= ~0x20;
        this.saSt = 0;
        return;
      }
      this.animMv = m;
      this.animRows = [r1, r2];
      this.saSt = 2;
      return;
    }
    if (this.animMv && !this.animMv.done) return;
    this.animMv = null;
    const S = this.sa;
    this.put(S.c2, S.r2, S.owner, S.king);
    this.land(S.c2, S.r2, S.dir);
    this.flags &= ~0x20;
    this.saSt = 0;
  }
  // 1494: a jump. The capture movie plays on the source square; then, except for a plain Koopa,
  // a walk onto the captured square, and a walk on to the landing square
  jumpAnim(arg, c1, r1, jc, jr, c2, r2) {
    if (arg === 0) {
      this.flags &= ~0x40;
      this.ja = null;
      this.jaSt = 0;
      return;
    }
    const J = this.ja;
    const fail = () => {
      this.animMv = null;
      this.put(J.c2, J.r2, J.owner, J.king);
      this.put(J.c1, J.r1, EMPTY, 0);
      this.put(J.jc, J.jr, EMPTY, 0);
      this.flags &= ~0x40;
      this.jaSt = 0;
    };
    switch (this.jaSt) {
      case 0: {
        this.flags |= 0x40;
        const from = this.cell(c1, r1);
        this.ja = { c1, r1, jc, jr, c2, r2, dir: this.dirOf(c1, r1, c2, r2), owner: from.owner, king: from.king };
        if (from.owner !== this.sides.mario) this.ouch();
        this.jaSt = 1;
        return;
      }
      case 1: {
        if (this.talking()) return;
        const m = this.openAnim(J.c1, J.r1, J.jc, J.jr, J.dir);
        if (!m) return fail();
        this.put(J.c1, J.r1, EMPTY, 0);
        this.put(J.jc, J.jr, EMPTY, 0);
        this.animMv = m;
        this.animRows = [J.r1, J.r2];
        this.jaSt = 2;
        return;
      }
      case 2: {
        if (this.animMv && !this.animMv.done) return;
        this.animMv = null;
        if (J.owner === 0 && J.king === 0) {
          this.jaSt = 3;
          return this.jumpAnim(1);
        }
        this.put(J.c1, J.r1, J.owner, J.king);
        const m = this.openAnim(J.c1, J.r1, J.jc, J.jr, J.dir);
        if (!m) return fail();
        this.put(J.c1, J.r1, EMPTY, 0);
        this.animMv = m;
        this.jaSt = 3;
        return;
      }
      case 3: {
        if (this.animMv && !this.animMv.done) return;
        this.animMv = null;
        this.put(J.jc, J.jr, J.owner, J.king);
        const m = this.openAnim(J.jc, J.jr, J.c2, J.r2, J.dir);
        if (!m) return fail();
        this.put(J.jc, J.jr, EMPTY, 0);
        this.animMv = m;
        this.jaSt = 4;
        return;
      }
      case 4:
        if (this.animMv && !this.animMv.done) return;
        this.animMv = null;
        this.put(J.c2, J.r2, J.owner, J.king);
        this.land(J.c2, J.r2, J.dir);
        this.flags &= ~0x40;
        this.jaSt = 0;
        return;
    }
  }

  // ---------------------------------------------------------------- 617d: blinking and idling
  // 05ac + 060e: a front-facing piece shuts its eyes for a tick now and then, more often the
  // longer nothing happens (sometimes two or more at once)
  pieceBlinks() {
    for (const [c, r] of SQUARES) this.cell(c, r).blink = 0;
    const k = Math.min(this.idle, 25);
    if ((rand15() * (35 - k)) >> 15) return;
    const front = [];
    for (let r = 0; r < 8; r++)
      for (let c = 0; c < 8; c++) {
        const cl = this.cell(c, r);
        if (cl.owner !== EMPTY && cl.facing === 0) front.push(cl);
      }
    if (!front.length) return;
    do front[((rand15() * front.length) / 32768) | 0].blink = 1;
    while (((rand15() * 10) / 32768 | 0) < 2);
  }
  // 0792: Mario's eyes (Pak 8999 frame 1 over the head) every 20-89 ticks while he is quiet
  headBlink() {
    const S = sess;
    if (++S.blinkT < S.blinkAt || this.talking()) return;
    if (S.blinkSt === 0) {
      if (this.flags & 0x80) {
        S.blinkSt = 2;
        return;
      }
      this.flags |= 0x100;
      S.blinkSt = 1;
    } else if (S.blinkSt === 1) {
      if (this.flags & 0x100) return;
      S.blinkSt = 2;
    } else {
      this.flags &= ~0x100;
      S.blinkAt = (((rand15() * 70) / 32768) | 0) + 20;
      S.blinkT = 0;
      S.blinkSt = 0;
    }
  }
  // 08de: after a while without input Mario fidgets (half the time), nags, or tells the next
  // knock-knock joke; a click cuts it short
  idleFlow(cut) {
    if (cut) this.idleCut = 1;
    if (!this.idleCut && this.talking()) return;
    const jokeLine = (k, next) => {
      if (this.talking()) return;
      if (--this.jokeGap > 0) return;
      this.say(JOKES[sess.joke][k]);
      this.jokeGap = 5;
      this.ist = this.idleCut ? 6 : next;
    };
    switch (this.ist) {
      case 0: {
        if (this.flags & (0x10 | 0x40 | 8 | 0x20) || this.over) return;
        if (this.idle < sess.idleAt) return;
        this.idle = 0;
        this.flags |= 0x80;
        this.idleCut = 0;
        if (rnd100() > 50) {
          this.hideHead();
          const id = bagPick(FIDGETS);
          if (!this.e.prs.has("MuV", id)) {
            this.ist = 0;
            this.flags &= ~0x80;
            sess.idleAt = 500;
            this.resetHead();
            return;
          }
          const m = (this.fidgetMv = this.e.movie(id));
          m.y += 4;
          m.x += 29;
          this.ist = 1;
          return;
        }
        const r = rnd100();
        if (r < 30) this.say(73); // "Hey, what's taking so long?"
        else if (r < 50) this.say(74); // "Do you still want to play?"
        else {
          sess.joke = sess.joke + 1 >= 4 ? 0 : sess.joke + 1;
          this.say(JOKES[sess.joke][0]);
          this.jokeGap = 5;
          this.ist = 2;
          return;
        }
        this.ist = 6;
        return;
      }
      case 1:
        if (!this.idleCut && this.fidgetMv && !this.fidgetMv.done) return;
        this.fidgetMv = null;
        this.resetHead();
        this.ist = 6;
        return;
      case 2:
        return jokeLine(1, 3);
      case 3:
        return jokeLine(2, 4);
      case 4:
        return jokeLine(3, 5);
      case 5:
        if (this.talking()) return;
        if (--this.jokeGap > 0) return;
        this.say(JOKES[sess.joke][4]);
        this.jokeGap = 5;
        this.ist = 6;
        return;
      case 6:
        this.flags &= ~0x80;
        this.idle = 0;
        sess.idleAt = (((rand15() * 250) / 32768) | 0) + 60;
        this.say(1);
        this.fidgetMv = null;
        this.resetHead();
        this.ist = 0;
        return;
    }
  }

  // every complete move the player could make, as square paths (used by the test bot)
  legalMoves() {
    const codes = new Uint8Array(32);
    SQUARES.forEach(([c, r], i) => {
      const cl = this.cell(c, r);
      if (cl.owner !== EMPTY) codes[i] = (cl.owner === this.sides.mario ? 2 : 1) | (cl.king ? 4 : 0);
    });
    const eng = new Engine(codes, 1, this.forced ? 1 : 0, 0xff);
    const res = [];
    const rec = (mv) => {
      let any = false;
      for (let dir = 4; dir < 8; dir++) {
        if (!eng.extend(1, mv, dir)) continue;
        any = true;
        if (!(rec(mv) && this.forced)) res.push(mv.path.slice(0, mv.cnt + 1));
        eng.pop(mv);
      }
      return any;
    };
    for (let sq = 0; sq < 32; sq++)
      if ((codes[sq] & 3) === 1) {
        const mv = newMove();
        mv.path[0] = sq;
        rec(mv);
      }
    if (!(res.length && this.forced))
      for (let sq = 0; sq < 32; sq++)
        for (let dir = 0; dir < 4; dir++) {
          const mv = newMove();
          mv.path[0] = sq;
          if (eng.extend(1, mv, dir)) res.push([sq, mv.path[1]]);
        }
    return res.map((p) => p.map((i) => SQUARES[i]));
  }

  // ---------------------------------------------------------------- input
  onCommand(cmd) {
    if (cmd === CMD.FORCED_JUMPS) {
      this.forced = this.e.prefs.forcedJumps !== false;
      return true;
    }
    return super.onCommand(cmd);
  }
  newGameRequest() {
    if (!this.ready || this.inModal) return;
    this.idle = 0;
    this.modal(this.dlgStartOver(), (yes) => yes && this.restart());
  }
  // 6000:111b: pieces first (front rows first, pixel exact), then the squares' highlight shapes
  hitTest(x, y) {
    const g = this.e.gfx;
    const opaque = (pak, frame, px, py) => {
      const f = g.frameInfo(pak, frame);
      if (!f || !f.w) return false;
      const lx = x - px - f.x, ly = y - py - f.y;
      return lx >= 0 && ly >= 0 && lx < f.w && ly < f.h && !!f.a[ly * f.w + lx];
    };
    for (let r = 7; r >= 0; r--)
      for (let c = 7; c >= 0; c--) {
        const cl = this.cell(c, r);
        if (!cl.play || cl.owner === EMPTY) continue;
        const p = this.pieceAt(cl);
        let f = p.frame;
        f = f === 8 ? 1 : f === 9 ? 3 : f === 10 ? 5 : f === 11 ? 7 : f;
        if (f < 0 || f > 7) f = 1;
        if (opaque(PIECES, f, p.x, p.y)) return [c, r];
      }
    for (let r = 0; r < 8; r++)
      for (let c = 0; c < 8; c++) {
        const cl = this.cell(c, r);
        if (cl.play && opaque(HILITES, cl.frame, cl.hx, cl.hy)) return [c, r];
      }
    if (this.e.pointer.type === "mouse") return null;
    // touch: the nearest square close by
    let best = null, bd = 14 * 14;
    for (const [c, r] of SQUARES) {
      const cl = this.cell(c, r);
      const dx = x - cl.ax, dy = (y - (cl.ay - 6)) * 1.6;
      if (dx * dx + dy * dy < bd) {
        bd = dx * dx + dy * dy;
        best = [c, r];
      }
    }
    return best;
  }
  pointerDown(x, y) {
    if (!this.ready || this.inModal) return;
    this.idle = 0;
    if (this.flags & 0x80) return void this.idleFlow(1);
    if (this.over || !(this.flags & 1) || this.talking()) return;
    const hit = this.hitTest(x, y);
    if (hit) this.input(1, hit[0], hit[1]);
  }
  key() {
    this.idle = 0;
  }

  // ---------------------------------------------------------------- tick / render (6000:0780)
  tick() {
    if (!this.ready || this.inModal) return;
    this.idle++;
    for (const m of [this.animMv, this.celebMv, this.fidgetMv]) if (m) m.sounds();
    this.flags &= ~(4 | 0x100); // the redraw (6000:0936) drops both after drawing
    for (const m of [this.animMv, this.celebMv, this.fidgetMv]) if (m) m.advanceOnce();
    this.pieceBlinks();
    this.startFlow(1);
    this.replay();
    this.input(1, -1, -1);
    if (this.flags & 8) this.stepDriver(1);
    if (this.flags & 0x10) this.jumpDriver(1);
    if (this.flags & 0x20) this.stepAnim(1);
    if (this.flags & 0x40) this.jumpAnim(1);
    if (!(this.flags & 0x200)) this.idleFlow(0);
    this.headBlink();
    this.talker.tick();
  }
  // 617d:0129: the piece's frame and position on its square
  pieceAt(cl) {
    const front = cl.facing === 0;
    if (cl.owner === 0) {
      if (cl.king) return { frame: front ? (cl.blink ? 11 : 7) : 6, x: cl.ax - 18, y: cl.ay - 32 };
      return { frame: front ? (cl.blink ? 10 : 5) : 4, x: cl.ax - 9, y: cl.ay - 21 };
    }
    if (cl.king) return { frame: front ? (cl.blink ? 9 : 3) : 2, x: cl.ax - 8, y: cl.ay - 30 };
    return { frame: front ? (cl.blink ? 8 : 1) : 0, x: cl.ax - 8, y: cl.ay - 16 };
  }
  render(scr) {
    const g = this.e.gfx;
    scr.clear(0);
    g.bg(2999);
    if (!this.ready) return;
    this.talker.drawText();
    this.drawName(265, 19, 223, 100); // 6000:10d6 allows 100 characters
    this.sp.draw();
    this.talker.draw();
    if (this.celebMv) this.celebMv.draw();
    if (this.fidgetMv) this.fidgetMv.draw();
    if (this.flags & 0x100) g.frame(8999, 1, 132, 14); // 0ad3
    // 617d:0030: highlighted squares, row by row
    for (let r = 0; r < 8; r++)
      for (let c = 0; c < 8; c++) {
        const cl = this.cell(c, r);
        if (cl.play && cl.lit) g.frame(HILITES, cl.frame, cl.hx, cl.hy);
      }
    // 617d:0d28: pieces row by row, the moving one after the farther of its two rows
    const animRow = this.animMv ? Math.min(this.animRows[0], this.animRows[1]) : 99;
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const cl = this.cell(c, r);
        if (!cl.play || cl.owner === EMPTY || cl.gone) continue;
        const p = this.pieceAt(cl);
        g.frame(PIECES, p.frame, p.x, p.y);
      }
      if (animRow === r) this.animMv.draw();
    }
  }
}
