<div align="center">

# 🎩 Mario's Game Gallery

**The 1995 Interplay/Presage DOS classic, rebuilt natively for the browser — desktop and touch screens, no emulator.**

[🇮🇹 Leggi in italiano](README.it.md) · [▶ Play](https://mich-de.github.io/mariosgg/)

![Engine](https://img.shields.io/badge/engine-native%20JavaScript-yellow)
![No emulation](https://img.shields.io/badge/DOSBox-not%20needed-success)
![Touch](https://img.shields.io/badge/mobile-touch%20ready-orange)

<img src="screenshots/menu.png" width="520" alt="Main menu: Mario presenting the easel">

</div>

## What is this

Mario, in top hat and tails, hosts five parlor games: **Checkers, Go Fish, Dominoes, Backgammon**
and **Yacht**. This repository is a native JavaScript port of the original game (Interplay /
Presage Software, February 1995). Nothing is emulated: the original executable was
reverse-engineered and every game — its rules, Mario's AI, what he says and when, every
animation — was ported routine by routine from its code. The art, sounds and music are read at
run time from the game's own resource file.

## Play

Open **https://mich-de.github.io/mariosgg/** (or serve this folder with any static web server)
and press **PLAY**.

- **Desktop:** point and click, as in 1995. The File / Options / Help menus work as in the original.
- **Phone or tablet:** tap. Hold the phone sideways; *Options › Fullscreen* (or the corner
  button, when there is room beside the picture) switches to full screen.
  Hit areas that were only a few pixels wide in the original are a little larger for fingers.
- **Screen shape:** *Options › Screen* shows the picture at 4:3 (as on the original monitor),
  16:10 or 16:9 (stretched to fill a phone; the default there). The choice is remembered.

## Screenshots

<p align="center">
  <img src="screenshots/checkers.png" width="320" alt="Checkers">
  <img src="screenshots/fish.png" width="320" alt="Go Fish">
  <img src="screenshots/dominoes.png" width="320" alt="Dominoes">
  <img src="screenshots/backgammon.png" width="320" alt="Backgammon">
  <img src="screenshots/yacht.png" width="320" alt="Yacht">
</p>

## How the port was made, step by step

### 1. The data: one resource archive

`mario.prs` holds everything the game shows and plays. It is a list of records
`[tag][id][name][length][payload]`; the formats were decoded from the executable and are read by
[`js/engine/res.js`](js/engine/res.js):

| Tag | What it is |
| --- | --- |
| `Pak` | sprite frames, compressed with a custom scanline RLE (also the fonts) |
| `DIB` | Windows bitmaps used only as 256-colour palettes |
| `SND` | 8-bit mono PCM sound effects and voice |
| `MuV` / `Ply` / `Img` | "movies": timelines of frames, offsets and sounds, used for every animation, including Mario's lip-synced talking head |
| `XMI` | music, XMIDI played on an emulated OPL2 (AdLib) chip in an AudioWorklet ([`music.js`](js/engine/music.js), [`opl-worklet.js`](js/engine/opl-worklet.js)) |

The archive is shipped gzipped as `data/mario.prs.gz`.

### 2. Making the code readable

`mario.exe` is a Borland C++ program that keeps most of its game code in VROOMM overlays (`FBOV`),
which disassemblers do not map. With the original `mario.exe` in `_source/mariosgg/`:

1. `python3 scripts/unoverlay.py _source/mariosgg/mario.exe analysis/mario_unified.exe analysis/mario_overlay_map.json`
   flattens the overlays into a plain executable and records every overlay entry stub.
2. `python3 scripts/re/listing.py analysis/mario.lst` disassembles every code segment (Capstone, 16-bit).
3. `python3 scripts/re/annot.py analysis/mario.lst analysis/mario.ann` resolves the overlay stubs,
   names the library routines (`scripts/re/names.txt`: sprites, movies, the talking head, dialogs…)
   and shows the data-segment strings each instruction refers to.
4. `python3 scripts/re/pseudo.py analysis/mario.ann <segment>` turns one segment into compact
   pseudo-code; `fn.py`, `jt.py` and `x86d.py` print one function, a jump table or raw instructions.
5. `scripts/extract_tables.py` pulls the phrase tables (text plus the movie that says it) out of the
   data segment into [`js/data/tables.js`](js/data/tables.js).

### 3. Mapping each game

Every game lives in its own overlays (the addresses in the source comments refer to them):

| Game | Overlays | Port |
| --- | --- | --- |
| Checkers | `659c` intro, `6000` flow, `617d` board and animation, `633c` geometry, `63e7` move input and rules, main segment `1a5d` Mario's search | [`checkers.js`](js/games/checkers.js) |
| Go Fish | `6f3e` intro, `7000` game, `6ea7` deck and Mario's memory | [`fish.js`](js/games/fish.js) |
| Dominoes | `6d82` intro, `6840` game | [`dominoes.js`](js/games/dominoes.js) |
| Backgammon | `5f80` intro, `5a32` game | [`backgammon.js`](js/games/backgammon.js) |
| Yacht | `7b14` intro, `7783` game, `7a78` Mario's dice planner | [`yacht.js`](js/games/yacht.js) |
| Logos, intro, menu, credits | `7454`, `7682`, `7493`, `5fac` | [`js/scenes/`](js/scenes) |

### 4. Porting the state machines, tick by tick

The original is driven by a timer that ticks every 110 ms (every second BIOS clock tick, about
9.1 times a second): every tick runs a fixed list of routines, each one a
small state machine with its own counter (`switch (state) … state++`) that waits on things like
"is Mario still talking?", "have the cards finished flying?" or a countdown. The port keeps
exactly that structure — the same routines, the same states, in the same order within a tick —
so the timing, the phrases and the dice rolls come out as in the original. In practice:

- **Rules and AI are the original's code.** Checkers uses the original plain minimax and its
  scoring (2 per capture, +2 for a king, 4 for a crown, 300 for a win), whose depth grows when
  you win; in Go Fish Mario remembers the ranks you asked for; Yacht has the original dice
  planner; Dominoes and Backgammon have Mario's original rules of thumb.
- **Randomness uses the original helpers:** phrase lists are "shuffle bags" that reshuffle once
  used up, ranges are `rand() * n / 32768`.
- **Quirks are kept** and marked *(sic)* in the comments (for example the Go Fish hand never
  refills its centre slot from the sides). The only deliberate changes are marked *(fix)*: places
  where the original would hang.

### 5. The engine

[`js/engine/`](js/engine): a 320×200 indexed-colour screen scaled to the window, Pak sprites and
fonts, the movie player, Mario's talking head with captions, the sprite list, pieces gliding in a
straight line one step per tick, sound effects, OPL2 music, the dialogs built from the original
descriptors, and the menu bar.

### 6. Touch

Pointer events are mapped onto the 320×200 frame; every game uses taps only (no dragging is
required). Where the original's click targets are tiny, touch gets a slightly larger area or
snaps to the nearest square, without changing what a click means.

### 7. Testing

- `index.html?debug&autostart&scene=<game>&speed=N` exposes the engine as `window.__mgg` and runs
  up to N times faster.
- [`scripts/cdp.mjs`](scripts/cdp.mjs) drives headless Chrome over the DevTools protocol (no Puppeteer).
- `node scripts/bot.mjs out/` starts every game from the menu on an emulated phone and plays it to
  the end with touch taps — the regression test run after every change.

## Repository layout

```
index.html           the page: canvas, loader, full-screen button
js/engine/           screen, resources, movies, talking head, audio and OPL2 music
js/scenes/           logos, title intro, main menu, credits
js/games/            the five games
js/ui/               menu bar, dialogs, help pages, name dialog
data/                mario.prs.gz (the original resources) and the OPL instrument bank
scripts/             unoverlay, resource and table extraction, test harness and bot
scripts/re/          disassembly, annotation and pseudo-code tools
```

## Credits

*Mario's Game Gallery* © 1995 Interplay Entertainment / Presage Software, made under license
from Nintendo. Shared here for preservation; this project is not affiliated with Interplay,
Presage or Nintendo.

---

<div align="center">

🤖 Built with [Claude Code](https://claude.com/claude-code)

</div>
