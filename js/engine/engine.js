// Engine core: scene + modal-layer management, the 10 Hz animation tick the original uses for
// its movies, the render loop and pointer/keyboard input mapped to 320x200 coordinates.

import { Screen } from "./screen.js";
import { Gfx, Sprites } from "./gfx.js";
import { Audio } from "./audio.js";
import { Movie } from "./movie.js";

export class Cancelled extends Error {}

export class Engine {
  constructor(canvas, prs) {
    this.prs = prs;
    this.screen = new Screen(canvas);
    this.gfx = new Gfx(this.screen, prs);
    this.audio = new Audio(prs);
    this.scene = null;
    this.layers = []; // modal UI on top of the scene (menus, dialogs); last = topmost
    this.token = { cancelled: false };
    this.tickMs = 100;
    this.speed = 1; // >1 only for automated tests (?debug&speed=N)
    this.lastTick = 0;
    this.tickCount = 0;
    this.waiters = [];
    this.pointer = { x: -1, y: -1, down: false, type: "mouse" };
    this.prefs = loadPrefs();
    this.audio.soundOn = this.prefs.sound;
    this.audio.musicOn = this.prefs.music;
    this.setPalette(1000);
    this.bindInput(canvas);
    requestAnimationFrame((t) => this.loop(t));
  }

  setSpeed(n) {
    this.speed = n;
    this.tickMs = 100 / n;
    this.audio.rate = n;
  }
  setPalette(id) {
    this.screen.setPalette(this.prs.palette(id));
  }

  movie(id) {
    return new Movie(this, id);
  }
  sprites() {
    return new Sprites(this.gfx);
  }

  // ---------------------------------------------------------------- scenes & async flows
  async setScene(scene) {
    this.token.cancelled = true;
    this.token = { cancelled: false };
    const old = this.scene;
    this.layers.length = 0;
    if (old && old.exit) old.exit();
    this.scene = scene;
    scene.e = this;
    scene.token = this.token;
    this.audio.stopSnd();
    if (scene.enter) {
      try {
        await scene.enter();
      } catch (err) {
        if (!(err instanceof Cancelled)) throw err;
      }
    }
  }
  // Run an async flow that dies quietly when the scene changes.
  run(fn) {
    const tok = this.token;
    return fn(tok).catch((err) => {
      if (!(err instanceof Cancelled)) console.error(err);
    });
  }
  check(tok = this.token) {
    if (tok.cancelled) throw new Cancelled();
  }
  sleep(ms, tok = this.token) {
    return new Promise((res, rej) => {
      setTimeout(() => (tok.cancelled ? rej(new Cancelled()) : res()), ms / this.speed);
    });
  }
  // Resolves on the next animation tick(s).
  ticks(n = 1, tok = this.token) {
    return new Promise((res, rej) => {
      const target = this.tickCount + n;
      const w = { target, res, rej, tok };
      this.waiters.push(w);
    });
  }

  pushLayer(l) {
    l.e = this;
    this.layers.push(l);
    return l;
  }
  popLayer(l) {
    const i = this.layers.indexOf(l);
    if (i >= 0) this.layers.splice(i, 1);
  }

  // ---------------------------------------------------------------- loop
  loop(now) {
    if (!this.lastTick) this.lastTick = now;
    let n = 0;
    while (now - this.lastTick >= this.tickMs && n < 5 * this.speed) {
      this.lastTick += this.tickMs;
      this.doTick();
      n++;
    }
    if (now - this.lastTick > 1000) this.lastTick = now;
    this.render();
    requestAnimationFrame((t) => this.loop(t));
  }
  doTick() {
    this.tickCount = (this.tickCount || 0) + 1;
    try {
      if (this.scene && this.scene.tick) this.scene.tick();
      for (const l of this.layers) if (l.tick) l.tick();
    } catch (err) {
      if (!(err instanceof Cancelled)) console.error(err);
    }
    const ws = this.waiters;
    this.waiters = [];
    for (const w of ws) {
      if (w.tok.cancelled) w.rej(new Cancelled());
      else if (this.tickCount >= w.target) w.res();
      else this.waiters.push(w);
    }
  }
  render() {
    const s = this.screen;
    if (this.scene && this.scene.render) this.scene.render(s);
    s.setClip(null);
    if (this.menubar && this.menubar.visible && !this.layers.some((l) => l.hideMenu)) this.menubar.render(s);
    for (const l of this.layers) if (l.render) l.render(s);
    s.present();
  }

  // ---------------------------------------------------------------- input
  bindInput(canvas) {
    this.waiters = [];
    const target = () => (this.layers.length ? this.layers[this.layers.length - 1] : this.scene);
    const send = (name, ev) => {
      this.audio.unlock();
      const p = this.screen.toScreen(ev.clientX, ev.clientY);
      this.pointer.x = p.x;
      this.pointer.y = p.y;
      this.pointer.type = ev.pointerType || "mouse";
      const mb = this.menubar;
      if (name === "pointerUp" && this.menuGrab) {
        // the release of a tap that went to the menu bar (it may have hidden the bar or
        // switched scenes meanwhile)
        this.menuGrab = false;
        return;
      }
      if (!this.layers.length && mb && mb.visible) {
        if (name === "pointerDown" && (mb.open >= 0 || p.y < 8)) {
          this.menuGrab = true;
          mb.pointerDown(p.x, p.y);
          return;
        }
        if (name === "pointerMove" && mb.open >= 0) return void mb.pointerMove(p.x, p.y);
      }
      const t = target();
      // a release only counts for whoever saw the press (a tap must not leak into a dialog
      // or scene it just opened)
      if (name === "pointerDown") this.downTarget = t;
      if (name === "pointerUp" && t !== this.downTarget) return;
      if (t && t[name]) {
        try {
          t[name](p.x, p.y, ev);
        } catch (err) {
          if (!(err instanceof Cancelled)) console.error(err);
        }
      }
    };
    canvas.addEventListener("pointerdown", (ev) => {
      ev.preventDefault();
      if (ev.button === 2) return;
      this.pointer.down = true;
      canvas.setPointerCapture && canvas.setPointerCapture(ev.pointerId);
      send("pointerDown", ev);
    });
    canvas.addEventListener("pointermove", (ev) => {
      ev.preventDefault();
      send("pointerMove", ev);
    });
    const up = (ev) => {
      ev.preventDefault();
      if (!this.pointer.down) return;
      this.pointer.down = false;
      send("pointerUp", ev);
    };
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);
    canvas.addEventListener("contextmenu", (ev) => ev.preventDefault());
    window.addEventListener("keydown", (ev) => {
      this.audio.unlock();
      if (ev.target && ev.target.id === "kb") return;
      const mb = this.menubar;
      if (!this.layers.length && mb && mb.visible) {
        if (mb.open >= 0 && mb.key(ev.key)) return void ev.preventDefault();
        if (ev.altKey && mb.openByKey(ev.key)) return void ev.preventDefault();
        if (ev.key === "F10") return void (mb.open = 0, ev.preventDefault());
      }
      const t = target();
      if (t && t.key) {
        try {
          if (t.key(ev.key, ev) !== false) ev.preventDefault();
        } catch (err) {
          if (!(err instanceof Cancelled)) console.error(err);
        }
      }
    });
  }

  savePrefs() {
    try {
      localStorage.setItem("mariosgg.prefs", JSON.stringify(this.prefs));
    } catch (e) {}
  }
}

// MARPREFS.DAT equivalent: player name, sound/music switches, checkers options.
function loadPrefs() {
  const def = { name: "", sound: true, music: true, forcedJumps: true, animated: true, seen: false };
  try {
    const p = JSON.parse(localStorage.getItem("mariosgg.prefs") || "{}");
    return Object.assign(def, p);
  } catch (e) {
    return def;
  }
}
