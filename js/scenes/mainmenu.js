// Main menu: Mario presenting the easel (overlay 7493). Tick-driven state machines mirror the
// original: selection change (0x0d77), blink (0x13a7), idle animations (0x1074), launching a
// game (0x14be) and the greeting when returning from a game (0x1739).

import { Talker } from "../engine/talker.js";
import { TABLES } from "../data/tables.js";

const BTN_Y = [77, 93, 108, 123, 138];
// Button hit rects (DGROUP 0x425c): x 58..136, 15-16 px tall.
const BTN = BTN_Y.map((y, i) => ({ l: 58, t: y, r: 136, b: i < 4 ? BTN_Y[i + 1] : 153 }));
// Snap-hand movie, position and idle step per game (0x0b62).
const HAND = { 1: [1111, 79, 10], 2: [1112, 79, 13], 3: [1113, 77, 10], 4: [1114, 82, 10], 5: [1115, 78, 8] };
const rnd = (n) => Math.floor(Math.random() * n);

export class MainMenu {
  constructor(returning) {
    this.returning = !!returning;
  }
  enter() {
    const e = this.e;
    e.setPalette(1000);
    const sp = (this.sp = e.sprites());
    for (let i = 0; i < 5; i++) sp.create(58, BTN_Y[i], 1040, i, 10 + i, true);
    sp.create(154, 104, 1010, 0, 100);
    for (let i = 0; i < 5; i++) sp.create(115, 80, 1020, i, 200 + i, true);
    sp.create(198, 153, 1011, 0, 500, true); // toe tap
    sp.create(189, 107, 1100, 0, 1500); // static tie
    sp.create(180, 49, 1014, 1, 471, true); // blink (eyes closed)
    this.rects = {
      toe: this.frameRect(1011, 0, 198, 153),
      tie: this.frameRect(1100, 0, 189, 107),
      head: this.frameRect(1014, 1, 180, 49),
    };
    this.talker = new Talker(e, { base: 12000, x: 183, y: 51, table: TABLES.menu });
    this.bow = e.movie(1101);
    this.bow.x = 174;
    this.bow.y = 98;
    this.bow.t = this.bow.dur - 1;
    this.bow.paused = true;
    this.bow.hidden = true;

    this.sel = e.lastGame || 1; // [0x8f72]
    this.shown = this.sel; // [0x8e4c]
    this.launch = -1; // [0x8f74]
    this.showSel(this.sel, true);
    this.setHand(this.sel);
    this.handIdle();
    this.selSt = { busy: false, step: 0 };
    this.blinkSt = { t: 0, wait: 10 + rnd(100), phase: 0, n: 0 };
    this.idleSt = { kind: 1 + rnd(3), last: -1, t: 0, wait: 10 + rnd(100), step: 0, running: false, toggles: 0, cd: 0, toeShown: false };
    this.idleSt.last = this.idleSt.kind;
    this.launchSt = null;
    if (this.returning) this.greet();
    else if (!e.app.firstMenu) this.greet();
    e.app.firstMenu = false;
    if (!e.audio.music || !e.audio.music.current) e.audio.playMusic(130);
  }
  frameRect(pak, fr, x, y) {
    const f = this.e.gfx.frameInfo(pak, fr);
    return { l: x + f.x, t: y + f.y, r: x + f.x + f.w, b: y + f.y + f.h };
  }
  showSel(n, on) {
    if (on) {
      this.sp.show(10 + n - 1);
      this.sp.show(200 + n - 1);
    } else {
      this.sp.hide(10 + n - 1);
      this.sp.hide(200 + n - 1);
    }
  }
  setHand(n) {
    const [id, y, idle] = HAND[n];
    this.hand = this.e.movie(id);
    this.hand.x = 242;
    this.hand.y = y;
    this.handIdleT = idle;
  }
  handIdle() {
    this.hand.t = this.hand.step * this.handIdleT;
    this.hand.paused = true;
    this.hand.hidden = false;
  }

  // ---------------------------------------------------------------- per-tick logic
  tick() {
    this.talker.tick();
    // draw/sounds then advance (0x074f / 0x072c)
    this.bow.sounds();
    this.hand.sounds();
    this.bow.advanceOnce();
    this.hand.advanceOnce();
    if (this.greeting) this.greetTick();
    else {
      this.selTick();
      this.blinkTick();
      this.idleTick();
    }
    if (this.launch !== -1) this.launchTick();
  }

  // Selection change: highlight walks one button per tick with a tap, the hand snaps away the
  // old item, the arm re-points, then the new item pops into the hand.
  selTick() {
    const st = this.selSt;
    if (!st.busy && this.shown === this.sel) return;
    if (this.launch !== -1 && !st.busy) return;
    switch (st.step) {
      case 0:
        st.busy = true;
        st.dir = this.sel - this.shown < 0 ? -1 : 1;
        st.cur = this.shown;
        st.target = this.sel;
        st.wait = 0;
        this.sp.hide(200 + this.shown - 1); // arm
        this.hand.paused = false; // finish the snap
        st.snapDone = false;
        st.step = 1;
        break;
      case 1: {
        if (!st.snapDone && this.hand.done) st.snapDone = true;
        if (this.sel !== st.target) {
          // target moved meanwhile: restart from where we are
          this.shown = st.cur;
          st.target = this.sel;
          st.dir = this.sel - st.cur < 0 ? -1 : 1;
        }
        this.sp.hide(10 + st.cur - 1);
        st.cur += st.dir;
        if (st.cur < 1) st.cur = 5;
        if (st.cur > 5) st.cur = 1;
        this.sp.show(10 + st.cur - 1);
        if (!this.e.audio.playing()) this.e.audio.playSnd(5003);
        if (st.cur === st.target) st.step = 2;
        break;
      }
      case 2:
        if (!st.snapDone) {
          if (this.hand.done) st.snapDone = true;
          else break;
        }
        if (st.wait++ < 2) break;
        st.step = 3;
        break;
      case 3:
        this.sp.show(200 + st.cur - 1);
        st.step = 4;
        break;
      case 4:
        this.setHand(st.cur);
        this.hand.hidden = false;
        this.hand.paused = false;
        st.handTarget = this.hand.step * this.handIdleT;
        st.step = 5;
        break;
      case 5:
        if (this.hand.t >= st.handTarget) {
          this.hand.t = st.handTarget;
          this.hand.paused = true;
          this.shown = st.cur;
          st.busy = false;
          st.step = 0;
        }
        break;
    }
  }

  blinkTick() {
    const st = this.blinkSt;
    if (st.phase === 0) {
      st.t++;
      if (st.t < st.wait || this.talker.talking) return;
      st.phase = 1;
      st.n = 2;
      this.sp.show(471);
      this.talker.hidden = true;
    } else if (st.phase === 1) {
      if (st.n-- > 0) return;
      this.sp.hide(471);
      this.talker.hidden = false;
      st.phase = 0;
      st.t = 0;
      st.wait = 10 + rnd(100);
    }
  }

  // Idle animations: 1 toe tap, 2 bow-tie spin, 3 say something.
  idleTick() {
    const st = this.idleSt;
    if (!st.running) {
      st.t++;
      if (st.t < st.wait || this.talker.talking || this.launch !== -1 || this.selSt.busy) return;
      st.running = true;
      st.step = 0;
      st.toggles = 0;
      st.cd = 0;
      st.toeShown = false;
    }
    if (st.step === 0) {
      if (st.kind === 1) {
        if (st.cd-- > 0) return;
        st.cd = 2;
        st.toeShown = !st.toeShown;
        if (st.toeShown) {
          this.sp.show(500);
          if (st.toggles > 0 && !this.e.audio.playing()) this.e.audio.playSnd(5004);
        } else this.sp.hide(500);
        st.toggles++;
        if (st.toggles > 5 && !st.toeShown) st.step = 1;
        return;
      }
      if (st.kind === 2) {
        this.sp.hide(1500);
        this.bow.hidden = false;
        this.bow.reset();
        this.e.audio.playSnd(5006);
        st.step = 1;
        return;
      }
      if (st.kind === 3) {
        this.talker.say(Math.random() * 100 > 50 ? 21 : 22);
        st.step = 1;
        return;
      }
    }
    if (st.step === 1) {
      if (st.kind === 2) {
        if (!this.bow.done) return;
        this.bow.hidden = true;
        this.sp.show(1500);
      }
      if (st.kind === 3 && this.talker.talking) return;
      // pick a different animation, restart the timer
      let k;
      do k = 1 + rnd(3);
      while (k === st.kind);
      st.kind = k;
      st.running = false;
      st.t = 0;
      st.wait = 10 + rnd(100);
    }
  }

  // Launch: crystal chime, "Great, I like..." + game name, then off we go.
  launchTick() {
    const st = (this.launchSt = this.launchSt || { step: 0 });
    const e = this.e;
    switch (st.step) {
      case 0:
        if (this.selSt.busy) return;
        if (this.shown !== this.launch) {
          this.showSel(this.shown, false);
          this.shown = this.sel = this.launch;
          this.showSel(this.shown, true);
          this.setHand(this.shown);
          this.handIdle();
        }
        if (Math.random() * 100 + 1 > 69) {
          st.p1 = 16;
          st.p2 = 1;
        } else {
          st.p1 = 15;
          st.p2 = this.namePhrase(this.launch, false);
        }
        e.audio.playSnd(5010);
        st.cd = 10;
        st.step = 1;
        break;
      case 1:
        if (st.cd-- > 0 || this.talker.talking) return;
        this.talker.say(st.p1);
        st.step = 2;
        break;
      case 2:
        if (this.talker.talking || e.audio.playing()) return;
        st.step = 3;
        break;
      case 3:
        if (st.p2 !== 1) {
          if (this.talker.talking || e.audio.playing()) return;
          this.talker.say(st.p2);
        }
        st.step = 4;
        break;
      case 4:
        if (this.talker.talking || e.audio.playing()) return;
        st.step = 5;
        e.audio.stopMusic();
        e.lastGame = this.launch;
        e.app.game(this.launch);
        break;
    }
  }
  // 0x166b: phrase saying the game's name (alternative take when `alt`).
  namePhrase(n, alt) {
    return { 1: [5, 10], 2: [8, 12], 3: [7, 14], 4: [6, 11], 5: [9, 13] }[n][alt ? 1 : 0];
  }

  // Coming back from a game: invitation + game name (0x1739).
  greet() {
    this.greeting = { step: 0 };
  }
  greetTick() {
    const st = this.greeting;
    switch (st.step) {
      case 0:
        st.step = 1;
        break;
      case 1:
        this.talker.say([2, 3, 4][rnd(3)]);
        st.step = 2;
        break;
      case 2:
        if (this.talker.talking) return;
        this.talker.say(this.namePhrase(this.sel, true));
        st.step = 3;
        break;
      case 3:
        if (this.talker.talking) return;
        this.greeting = null;
        break;
    }
  }

  // ---------------------------------------------------------------- input
  btnAt(x, y) {
    const i = BTN.findIndex((r) => x >= r.l && x < r.r && y >= r.t && y < r.b);
    return i + 1;
  }
  pointerMove(x, y) {
    if (this.e.pointer.type !== "mouse" || this.launch !== -1) return;
    const n = this.btnAt(x, y);
    if (n && n !== this.sel) this.sel = n;
  }
  pointerDown(x, y) {
    if (this.launch !== -1 || this.greeting) return;
    const n = this.btnAt(x, y);
    if (n) {
      this.sel = n;
      this.launch = n;
      return;
    }
    const inR = (r) => x >= r.l && x < r.r && y >= r.t && y < r.b;
    if (inR(this.rects.head)) this.blinkSt.t = 999;
    if (this.idleSt.running) return;
    if (inR(this.rects.tie)) {
      this.idleSt.kind = 2;
      this.idleSt.t = 999;
    } else if (inR(this.rects.toe)) {
      this.idleSt.kind = 1;
      this.idleSt.t = 999;
    }
  }
  key(k) {
    if (this.launch !== -1) return;
    const map = { c: 1, g: 2, d: 3, b: 4, y: 5 };
    const lk = k.toLowerCase();
    if (map[lk]) this.sel = map[lk];
    else if (k === "ArrowUp") this.sel = this.sel <= 1 ? 5 : this.sel - 1;
    else if (k === "ArrowDown") this.sel = this.sel >= 5 ? 1 : this.sel + 1;
    else if (k === "Enter" || k === " ") this.launch = this.sel;
    else return false;
  }

  render(s) {
    s.clear(0);
    this.e.gfx.bg(1001);
    this.sp.draw();
    this.talker.draw();
    this.bow.draw();
    this.hand.draw();
  }
}
