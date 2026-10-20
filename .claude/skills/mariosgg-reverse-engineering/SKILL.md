---
name: mariosgg-reverse-engineering
description: Reverse-engineer mario.exe (Mario's Game Gallery, Interplay/Presage 1995, Borland C++ for DOS with VROOMM overlays) and port or change its behaviour in this repository's native JavaScript port. Use when you need to find how the original does something (game rules, Mario's AI, what he says and when, animation and timing), port a routine from the executable, fix a bug in one of the five games, or add a feature, and when you test and ship such a change.
---

# Mario's Game Gallery: reverse engineering and changes

**The original's code is the spec.** Rules, Mario's AI, his phrases and when he says them,
animations and timing all come from `mario.exe`, never from guesses or from "how the game is
usually played". If you have not found it in the executable yet, keep looking instead of
approximating. Guessed rules have shipped here before (Yacht scoring) and were wrong.

Addresses, data formats and the map of which overlay holds which game are in
[reference.md](reference.md).

## Setup

- The original install goes in `_source/mariosgg/` (`mario.exe`, `mario.prs`, ...). It is
  gitignored: never commit it. `analysis/` (generated) is gitignored too.
- Python 3 with `uv`: Capstone (disassembler) and Pillow (sprite sheets) are pulled on demand
  with `uv run --with ...`.
- Node 18+ and `google-chrome-stable` on the PATH for the tests.

## 1. Rebuild the analysis files (a couple of seconds)

```sh
python3 scripts/unoverlay.py _source/mariosgg/mario.exe analysis/mario_unified.exe analysis/mario_overlay_map.json
uv run --with capstone python3 scripts/re/listing.py analysis/mario.lst
python3 scripts/re/annot.py analysis/mario.lst analysis/mario.ann
```

- `unoverlay.py` flattens the VROOMM overlays (`FBOV`) into a plain MZ: each segment and overlay
  gets its own paragraph slot, and the overlay entry stubs become far jumps into the overlay code.
- `mario.ann` is the whole program disassembled, with each far call resolved through its overlay
  stub (`=>` marks one), library routines named from `scripts/re/names.txt`, and data-segment
  strings shown next to the instruction that pushes their offset.
- An address `SSSS:OOOO` uses the unified executable's segments (0x1000 + paragraph).
  These are the numbers used throughout the source comments: `1000`–`4xxx` is resident code,
  each overlay has its own segment (`6000`, `617d`, `7783`, ...). Operands such as `[0x1d02]` are
  globals in DGROUP, the data segment.

## 2. Read the code

```sh
python3 scripts/re/pseudo.py analysis/mario.ann 617d > analysis/p_617d.txt   # a segment as pseudo-code
python3 scripts/re/fn.py analysis/p_617d.txt 08de                           # one function (--calls: only its calls)
uv run --with capstone python3 scripts/re/x86d.py 1000:1300 20              # raw instructions at any address
uv run --with capstone python3 scripts/re/jt.py 6000 904 5                  # a switch's jump table: case:target
uv run --with pillow python3 scripts/re/sheets.py analysis/sheets           # every Pak as a PNG contact sheet
```

`pseudo.py` folds pushes into call arguments in C order (`CALL 1aec:01a0(arg1, arg2)`), turns
`mov` into assignments and labels jump targets `L_xxxx`. Calls are far cdecl: in a function,
`[bp + 6]` is the first argument, `[bp + 8]` the second, and `[bp - n]` are locals.

Ways in:

- **From a phrase or caption**: grep its text in `analysis/mario.ann`, then read the function
  that pushes it. The phrase tables (text plus the movie that says it) are listed in
  `scripts/extract_tables.py`.
- **From a resource**: sprites, movies and sounds are pushed as numbers, so Pak 2500 is
  `push 0x9c4`.
- **From a library call**: CreateSprite, DrawMovieAt, DrawTextCentered, the talker
  (`1aec:005a`) and the others in `names.txt`. When you identify a routine, add it to
  `names.txt` and run `annot.py` again.
- **Switches**: `cmp bx, N; ja …; shl bx, 1; jmp word ptr cs:[bx + T]` is a dense switch, decoded
  with `jt.py SEG T N+1`. A loop that compares `cs:[bx]` and then jumps through `cs:[bx + K]` is a
  sparse switch: a table of case values followed by the table of targets.
- **Overlay or state**: the per-game overlays and the key routines are listed in
  [reference.md](reference.md).

## 3. Port a routine

The original runs on one timer tick of 109.85 ms (every second BIOS clock tick, about 9.1 Hz).
Each tick calls a fixed list of routines. Each routine is a small state machine: a
`switch (state)`, counters, waits on things like "is Mario still talking?" or "have the cards
landed?". Port it literally:

1. Keep the same states and state numbers, the same counters, the same order of the calls
   within a tick, and the same globals. Note the DGROUP offset in a comment, for example
   `this.count = 10; // [0x1d02]`.
2. Head each ported routine with its address (`// ---- 6000:0b0b: game start and end`) and mark
   important branches (`// 02a3: the side the player picked`). Comment phrase numbers with
   their text.
3. Randomness: use `rnd(n)` (the original's `rand() * n / 32768`) and pick from phrase lists with
   `bagPick` / `sayRandom` (the original's shuffle bag, `36b6:0004`).
4. Keep the original's quirks and mark them `(sic)`. Change only what would hang or break the
   game, mark it `(fix)`, and say what the original did.
5. `js/data/tables.js` is generated. Rebuild it with
   `python3 scripts/extract_tables.py _source/mariosgg/mario.exe js/data/tables.js` and never edit
   it by hand.

Example (`js/games/checkers.js`, the start of a game, `6000:0b0b`):

```js
switch (this.st) {
  case 1:
    if (this.talking()) return;
    this.say(72); // "Do you want to play as a Yoshi, or as a Koopa?"
    this.idle = 0;
    this.st = 2;
    return;
```

## 4. Change or add something

- **Where**: the code is split into four places.
  - `js/engine/`: screen, resources, movies, talking head, sprites, sound and OPL2 music.
  - `js/games/<game>.js`: one file per game, with `base.js` shared by all of them.
  - `js/scenes/`: logos, intro, menu and credits; `flow.js` handles the top-level commands.
  - `js/ui/`: the menu bar (`toolkit.js`), dialogs, help pages and the name dialog.
- **Behaviour**: read what the original does first (step 2). When something is reported as
  wrong, check the executable before changing the port, because the port is often right.
- **Additions the original does not have** (bigger touch targets, Options › Screen and
  Fullscreen, the screen wake lock) must not change rules or flow. Mark them
  `not in the original` and keep the original look: palette, fonts, menu style.
- **Menus**: add a `CMD` and its items in `js/ui/toolkit.js` (`MENUS`), then handle it in
  `App.command` (`js/scenes/flow.js`) or in the scene's `onCommand`. Preferences live in
  `engine.prefs` (saved to `localStorage["mariosgg.prefs"]` by `savePrefs()`).
- **Touch**: taps only, never a required drag. Enlarge a tiny hit area or snap to the nearest
  target, but do not change what a click means.
- **Documentation**: put user-visible changes in both `README.md` and `README.it.md`.

## 5. Test

- `index.html?debug&autostart&scene=<menu|intro|credits|checkers|fish|dominoes|backgammon|yacht>&speed=N`
  exposes the engine as `window.__mgg` (`__mgg.scene` is the running game with all its state).
  `N` runs the ticks N times faster.
- `node scripts/cdp.mjs "index.html?debug&autostart&scene=yacht" out.png 4000` saves the exact
  320×200 framebuffer. Set `MOBILE=1` to emulate a phone.
- Run the regression after every change: `node scripts/bot.mjs OUTDIR` plays all five games
  from the menu with touch taps, at 8× speed, on an emulated phone. Every game must report
  `"outcome":"back to menu"`. If one gets stuck, look at `OUTDIR/bot_<game>.png` and at the
  last `why` in the log, and check whether the problem is the bot before you touch the game.
  For example, a large sprite in front can cover the square the bot wants to tap: hit tests are
  pixel-exact, as in the original.
- When in doubt, run the original game (in DOSBox, outside this repository) and compare.

## 6. Ship

- GitHub Pages serves the repository root from `master` (https://mich-de.github.io/mariosgg/).
  After a push, check the build with
  `gh api repos/mich-de/mariosgg/pages/builds/latest --jq '.status + " " + .commit'`.
- Commit the port and its data (`data/mario.prs.gz`), never `_source/` or `analysis/`.
