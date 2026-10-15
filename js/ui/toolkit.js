// The original's GUI toolkit is a text-mode windowing library (40x25 cells, 8x8 BIOS font)
// rendered into the VGA frame. Its 16 text colours are the EGA colours mapped to the nearest
// entries of the current palette (3759:0001 + 31cd:012f).

const EGA = [
  [0, 0, 0], [0, 0, 0xaa], [0, 0xaa, 0], [0, 0xaa, 0xaa], [0xaa, 0, 0], [0xaa, 0, 0xaa], [0xaa, 0x55, 0], [0xaa, 0xaa, 0xaa],
  [0x55, 0x55, 0x55], [0x55, 0x55, 0xff], [0x55, 0xff, 0x55], [0x55, 0xff, 0xff], [0xff, 0x55, 0x55], [0xff, 0x55, 0xff], [0xff, 0xff, 0x55], [0xff, 0xff, 0xff],
];

export function egaColors(pal) {
  return EGA.map(([r, g, b]) => {
    let best = 0, bd = 1e9;
    for (let i = 0; i < 256; i++) {
      const dr = pal[i * 3] - r, dg = pal[i * 3 + 1] - g, db = pal[i * 3 + 2] - b;
      const d = dr * dr + dg * dg + db * db;
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  });
}

// Menu definitions recovered from the data segment (module offset 0x30000..0x36368):
// command ids are the original IDM_* values.
export const CMD = {
  CREDITS: 9, NEW_GAME: 10, EXIT_TO_MENU: 11, EXIT: 12, CHANGE_NAME: 13, MUSIC: 14, SOUND: 15,
  ANIMATED: 16, FORCED_JUMPS: 17, HELP_BACKGAMMON: 20, HELP_CHECKERS: 21, HELP_DOMINOES: 22, HELP_FISH: 23, HELP_YACHT: 24,
};
const OPTS = [{ label: "~Change Name", cmd: CMD.CHANGE_NAME }, { label: "~Music", cmd: CMD.MUSIC, check: "music" }, { label: "~Sound", cmd: CMD.SOUND, check: "sound" }];
const GAME_FILE = { title: "~File", items: [{ label: "~New Game", cmd: CMD.NEW_GAME }, { sep: true }, { label: "~Exit to Main Menu", cmd: CMD.EXIT_TO_MENU }] };
export const MENUS = {
  main: [
    { title: "~File", items: [{ label: "~Credits", cmd: CMD.CREDITS }, { label: "~Exit", cmd: CMD.EXIT }] },
    { title: "~Options", items: OPTS },
    { title: "~Help", items: [
      { label: "~Backgammon Help", cmd: CMD.HELP_BACKGAMMON }, { label: "~Checkers Help", cmd: CMD.HELP_CHECKERS },
      { label: "~Dominoes Help", cmd: CMD.HELP_DOMINOES }, { label: "~Go Fish Help", cmd: CMD.HELP_FISH }, { label: "~Yacht Help", cmd: CMD.HELP_YACHT },
    ] },
  ],
  fish: [GAME_FILE, { title: "~Options", items: OPTS }, { title: "~Help", items: [{ label: "~Go Fish Help", cmd: CMD.HELP_FISH }] }],
  checkers: [GAME_FILE, { title: "~Options", items: [...OPTS, { sep: true }, { label: "~Forced Jumps", cmd: CMD.FORCED_JUMPS, check: "forcedJumps" }] },
    { title: "~Help", items: [{ label: "~Checkers Help", cmd: CMD.HELP_CHECKERS }] }],
  dominoes: [GAME_FILE, { title: "~Options", items: OPTS }, { title: "~Help", items: [{ label: "~Dominoes Help", cmd: CMD.HELP_DOMINOES }] }],
  backgammon: [GAME_FILE, { title: "~Options", items: [...OPTS, { sep: true }, { label: "~Animated Pieces", cmd: CMD.ANIMATED, check: "animated" }] },
    { title: "~Help", items: [{ label: "~Backgammon Help", cmd: CMD.HELP_BACKGAMMON }] }],
  yacht: [GAME_FILE, { title: "~Options", items: OPTS }, { title: "~Help", items: [{ label: "~Yacht Help", cmd: CMD.HELP_YACHT }] }],
};

const plain = (s) => s.replace("~", "");
const hot = (s) => {
  const i = s.indexOf("~");
  return i < 0 ? -1 : i;
};

// Top menu bar (row 0) with drop-down menus. Titles sit after two spaces each, starting at
// column 1 (File at col 3, Options at col 9, Help at col 18 — measured on the original).
export class MenuBar {
  constructor(e, menus, onCommand) {
    this.e = e;
    this.menus = menus;
    this.onCommand = onCommand;
    this.open = -1;
    this.hover = -1;
    this.visible = true;
    let col = 1;
    this.cols = menus.map((m) => {
      col += 2;
      const c = col;
      col += plain(m.title).length;
      return c;
    });
  }
  colors() {
    if (!this.c || this.cPal !== this.e.screen.pal[180] + this.e.screen.pal[300]) {
      this.c = egaColors(this.e.screen.pal);
      this.cPal = this.e.screen.pal[180] + this.e.screen.pal[300];
    }
    return this.c;
  }
  drawLabel(s, label, col, row, fg, bg, hk) {
    const p = plain(label);
    const h = hot(label);
    for (let i = 0; i < p.length; i++) s.char8(p.charCodeAt(i), (col + i) * 8, row * 8, i === h ? hk : fg, bg);
  }
  box(m) {
    const w = Math.max(...m.items.map((it) => (it.sep ? 0 : plain(it.label).length))) + 4;
    const col = Math.max(0, Math.min(this.cols[this.menus.indexOf(m)] - 1, 40 - w - 1));
    return { col, row: 1, w, h: m.items.length + 2 };
  }
  render(s) {
    if (!this.visible) return;
    const C = this.colors();
    const Y = C[14], K = C[0], R = C[4], G = C[2], D = C[8];
    s.setClip(null);
    s.fillRect(0, 0, 320, 8, Y);
    this.menus.forEach((m, i) => {
      const sel = i === this.open;
      if (sel) s.fillRect((this.cols[i] - 1) * 8, 0, (this.cols[i] + plain(m.title).length + 1) * 8, 8, G);
      this.drawLabel(s, m.title, this.cols[i], 0, K, sel ? G : Y, R);
    });
    if (this.open < 0) return;
    const m = this.menus[this.open];
    const b = this.box(m);
    // shadow (attribute 0x08 over whatever is underneath)
    s.fillRect((b.col + 1) * 8, (b.row + b.h) * 8, (b.col + b.w + 1) * 8, (b.row + b.h + 1) * 8, K);
    s.fillRect((b.col + b.w) * 8, (b.row + 1) * 8, (b.col + b.w + 1) * 8, (b.row + b.h) * 8, K);
    for (let r = 0; r < b.h; r++) {
      for (let c = 0; c < b.w; c++) {
        let ch = 32;
        const top = r === 0, bot = r === b.h - 1, left = c === 0, right = c === b.w - 1;
        if (top && left) ch = 0xda; else if (top && right) ch = 0xbf; else if (bot && left) ch = 0xc0; else if (bot && right) ch = 0xd9;
        else if (top || bot) ch = 0xc4; else if (left || right) ch = 0xb3;
        const it = m.items[r - 1];
        if (it && it.sep) ch = left ? 0xc3 : right ? 0xb4 : 0xc4;
        s.char8(ch, (b.col + c) * 8, (b.row + r) * 8, K, Y);
      }
    }
    m.items.forEach((it, i) => {
      if (it.sep) return;
      const row = b.row + 1 + i;
      const sel = i === this.hover;
      const bg = sel ? G : Y;
      if (sel) s.fillRect((b.col + 1) * 8, row * 8, (b.col + b.w - 1) * 8, row * 8 + 8, G);
      if (it.check && this.e.prefs[it.check]) s.char8(0xfb, (b.col + 1) * 8, row * 8, K, bg);
      this.drawLabel(s, it.label, b.col + 2, row, it.disabled ? D : K, bg, R);
    });
  }
  // Returns true when the event belongs to the menu bar.
  pointerDown(x, y) {
    if (!this.visible) return false;
    const col = (x / 8) | 0, row = (y / 8) | 0;
    if (row === 0) {
      const i = this.menus.findIndex((m, k) => col >= this.cols[k] - 1 && col < this.cols[k] + plain(m.title).length + 1);
      this.open = i === this.open ? -1 : i;
      this.hover = -1;
      return true;
    }
    if (this.open >= 0) {
      const m = this.menus[this.open];
      const b = this.box(m);
      if (col >= b.col && col < b.col + b.w && row > b.row && row < b.row + b.h - 1) {
        const it = m.items[row - b.row - 1];
        if (it && !it.sep && !it.disabled) {
          this.open = -1;
          this.hover = -1;
          this.fire(it);
        }
        return true;
      }
      this.open = -1;
      return true;
    }
    return false;
  }
  pointerMove(x, y) {
    if (this.open < 0) return false;
    const m = this.menus[this.open];
    const b = this.box(m);
    const col = (x / 8) | 0, row = (y / 8) | 0;
    this.hover = col >= b.col && col < b.col + b.w && row > b.row && row < b.row + b.h - 1 ? row - b.row - 1 : -1;
    if (row === 0) {
      const i = this.menus.findIndex((mm, k) => col >= this.cols[k] - 1 && col < this.cols[k] + plain(mm.title).length + 1);
      if (i >= 0) this.open = i;
    }
    return true;
  }
  key(k) {
    if (this.open < 0) return false;
    const m = this.menus[this.open];
    if (k === "Escape") this.open = -1;
    else if (k === "ArrowDown" || k === "ArrowUp") {
      const d = k === "ArrowDown" ? 1 : -1;
      let h = this.hover;
      for (let n = 0; n < m.items.length; n++) {
        h = (h + d + m.items.length) % m.items.length;
        if (!m.items[h].sep) break;
      }
      this.hover = h;
    } else if (k === "ArrowLeft" || k === "ArrowRight") {
      this.open = (this.open + (k === "ArrowRight" ? 1 : -1) + this.menus.length) % this.menus.length;
      this.hover = -1;
    } else if (k === "Enter" && this.hover >= 0) {
      const it = m.items[this.hover];
      this.open = -1;
      this.fire(it);
    } else {
      const it = m.items.find((t) => !t.sep && hot(t.label) >= 0 && plain(t.label)[hot(t.label)].toLowerCase() === k.toLowerCase());
      if (it) {
        this.open = -1;
        this.fire(it);
      }
    }
    return true;
  }
  fire(it) {
    if (it.check) {
      this.e.prefs[it.check] = !this.e.prefs[it.check];
      this.e.savePrefs();
      if (it.check === "sound") this.e.audio.setSound(this.e.prefs.sound);
      if (it.check === "music") this.e.audio.setMusic(this.e.prefs.music);
    }
    this.onCommand(it.cmd);
  }
  openByKey(k) {
    const i = this.menus.findIndex((m) => plain(m.title)[0].toLowerCase() === k.toLowerCase());
    if (i >= 0) {
      this.open = i;
      this.hover = -1;
      return true;
    }
    return false;
  }
}

// Modal dialog built from one of the prerendered dialog Paks (100 name, 101 play-as,
// 105 start over, 106 play again, 111 draw): frame 0 is the box, frames 1/2 the two buttons,
// frames 3/4 the same buttons pressed.
export class PakDialog {
  constructor(e, pakId, x, y, buttons) {
    this.e = e;
    this.pakId = pakId;
    this.x = x;
    this.y = y;
    this.buttons = buttons; // [{frame, pressed, x, y, value, key}]
    this.down = null;
    this.promise = new Promise((res) => (this.resolve = res));
  }
  render(s) {
    const g = this.e.gfx;
    g.frame(this.pakId, 0, this.x, this.y);
    for (const b of this.buttons) g.frame(this.pakId, this.down === b ? b.pressed : b.frame, this.x + b.x, this.y + b.y);
    if (this.renderExtra) this.renderExtra(s);
  }
  hitButton(x, y) {
    for (const b of this.buttons) {
      const f = this.e.gfx.frameInfo(this.pakId, b.frame);
      const l = this.x + b.x, t = this.y + b.y;
      // generous touch margin
      if (x >= l - 3 && x < l + f.w + 3 && y >= t - 3 && y < t + f.h + 3) return b;
    }
    return null;
  }
  pointerDown(x, y) {
    this.down = this.hitButton(x, y);
    if (this.down) this.e.audio.playSnd(9204);
  }
  pointerMove(x, y) {
    if (this.down && this.e.pointer.down && this.hitButton(x, y) !== this.down) this.down = null;
  }
  pointerUp(x, y) {
    const b = this.hitButton(x, y);
    const was = this.down;
    this.down = null;
    if (b && b === was) this.close(b.value);
  }
  key(k) {
    const b = this.buttons.find((bb) => bb.key && bb.key.includes(k.toLowerCase()));
    if (b) this.close(b.value);
  }
  close(v) {
    this.e.popLayer(this);
    this.resolve(v);
  }
  show() {
    this.e.pushLayer(this);
    return this.promise;
  }
}
