# Reference: mario.exe and the native port

Addresses use the segments of `analysis/mario_unified.exe` (0x1000 + paragraph), as in
`analysis/mario.ann` and in the source comments.

## The executable

- DOS MZ built with Borland C++ (large model) and VROOMM overlays. After the load module there
  is an `FBOV` header (u32 overlay size, u32 segment-table file offset, u32 segment count).
  Each segment-table record is u16 paragraph, u16 size, u16 kind (0 data, 1 code, 3 overlay
  stub, 4 stack/bss), u16 low offset. Overlay stubs start with `INT 3Fh` and list the entry
  points. The full format is in the docstring of `scripts/unoverlay.py`.
- Unified: 112 frames, 31 overlays, 505 overlay thunks.
- Calls are far cdecl: arguments are pushed right to left and the caller pops them
  (`add sp, N`). Results come back in `ax`, or in `dx:ax` for longs.
- DGROUP (the data segment) is paragraph 0x4000 of the unified module: `annot.py` reads bytes
  0x40000–0x4ffff of the load module for strings.

## C runtime (segment 1000)

| Address | Routine |
| --- | --- |
| 1000:0e6c | far memcpy |
| 1000:0f26 | long division, signed. The four long ÷ / % helpers share the body at 0f40, with `cx` = 0 div, 1 unsigned div, 2 mod, 3 unsigned mod |
| 1000:0f35 | long remainder, signed |
| 1000:0fd4 | long shift left, `dx:ax <<= cl` |
| 1000:0ff5 | long shift right, unsigned, `dx:ax >>= cl` |
| 1000:1300 | `rand()`: seed = seed × 0x015a4e35 + 1, returns (seed >> 16) & 0x7fff, seed at DGROUP 0x5e1c. The game takes ranges as `rand() * n / 32768` |

## Engine routines (resident code)

| Address | Routine |
| --- | --- |
| 2b26:0050 | INT 8 hook: advances the game clock by 55 every BIOS tick |
| 290a:0612 | arms the animation timer with period 110: the timer slots at 3c4c post message 0x66, the game tick, every second BIOS tick (109.85 ms) |
| 2b26:0990 | SendMessage(window, msg, …) |
| 333c:2210 | GetResource(tag, id). Handles: 2339:2a75 HLock, 2339:2ac2 HUnlock, 2339:2a03 DisposeHandle |
| 35a7:0007 / 002b | LoadPak(id) / ReleasePak(h) |
| 35a7:01e1 | DrawPakFrame(x, y, pak, frame). Also 01fb FrameSize, 03a9 PakFrameRect(&r, pak, frame, x, y), 03c7 FrameOffset |
| 356e:00b3 / 0220 | OffsetRect / SectRect |
| 1408:000c / 00bd / 0170 | DrawText / DrawTextRight / DrawTextCentered(font, str, max, x, y): glyph = character − 0x20, a space is as wide as glyph 0x49, the text is cut at `max` characters |
| 1919:… | sprite list (see below) |
| 3c63:0114 | Fly(steps, x0, y0, x1, y1, pak, frame, arg, callback) (see below). 3c63:018c is the variant Dominoes uses for its bones |
| 2d21:01e6 / 03cf / 077f | LoadMovie / DisposeMovie / DrawMovieAt(h, t32, x, y, inval, clip) |
| 2dd5:… | movie object: 0005 Open, 0065 Close, 0083 SetPaused, 00ca SetHidden, 0111 Draw, 01cc AdvanceOnce, 0256 AdvanceThenClose, 02e2 AdvanceLoop, 0368 Sounds, 03af OpenStep |
| 1aec:0000 | talking head: init with the phrase table |
| 1aec:005a | Talk(movie, text, snd). Movie 0 with a sound id shows only the caption and plays a plain SND |
| 1aec:01a0 | Say(i): phrase `i` of the table |
| 1aec:01e2 | SayRandom(list), through 36b6:0004 |
| 1aec:02b0 | IsTalking = `[0x7524]`, set only while a talk movie runs |
| 36b6:0004 | shuffle bag over a DGROUP list {count, index, items[]}: index++, reshuffle when it reaches count; index starts at count (a few lists start at 0). Ported as `bagPick(items, start)` in `js/games/base.js` |

**Sprites (1919)**:

- 00bb CreateSprite(x, y, pak, frame, id), 0179 CreateSpriteAnon, 0228 DeleteAllSprites,
  0294 DeleteSprite, 0916 Hide, 0928 Show, 09b4 ToBack, 0a39 ToFront.
- Creating never replaces an id: duplicates are allowed, and Delete, Hide and Show act on the
  newest one.
- Sprites are drawn oldest first, so the newest is on top.

**Flights (3c63:0114)**:

- The path has steps + 1 points (3be9:008a), one per tick. The sprite lands one tick after the
  last point and the callback runs; callbacks are thunks in segment 48ea that lead into
  overlay code.
- With 0 steps there is no flight and no callback.
- The newest flight is drawn first.

## Timing

- Game tick = 2 × 65536 / 1193182 s = 109.85 ms (about 9.1 Hz): `TICK_MS` in
  `js/engine/engine.js`. Every per-tick routine in the port runs once per tick, in the
  original's order.
- Movies run at 600 time units per second and advance 60 units per tick.

## Data in DGROUP

Phrase tables (from `scripts/extract_tables.py`, exported to `js/data/tables.js`):

| Table | Offset | Record | Records |
| --- | --- | --- | --- |
| menu | 0x41ae | 6 | 23 |
| intro | 0x4d34 | 6 | 3 |
| checkers | 0x15c6 | 6 | 91 |
| dominoes | 0x2724 | 16 | 90 |
| fish | 0x358c | 6 | 87 |
| yacht | 0x568a | 6 | 74 |
| backgammon | 0x0692 | 6 | 59 |

A 6-byte record is {u16 text, u16 movie, u16 0}. The Dominoes 16-byte record is
{text, movie, sound list[5], count}.

## mario.prs

The container has a 0x30-byte header ("PRS Format Resource File\r\n", zero padding, 0x1A),
followed by records {char[4] tag, u16 id, char[18] name, u32 length including the 28-byte
header, payload}. It is read by `js/engine/res.js`, `scripts/re/prs.py` and
`scripts/prs_extract.py`.

| Tag | Format |
| --- | --- |
| Pak | {u16 version, u16 count, u16, u32 offset[count]}. A frame header is **4 bytes**, big-endian u16 width and height, with no background byte. If version & 0x8000 it is 8 bytes: big-endian x, y, w, h, where x and y are signed draw offsets. Pixels use a scanline RLE (`scripts/re/pak.py`, `res.js`); pixels it never writes are transparent. Fonts are Paks too |
| `*TIL` Paks | 320×200 backgrounds made of 64 tiles of 40×25; tile i sits at (i % 8 × 40, ⌊i / 8⌋ × 25) |
| DIB | Windows bitmaps used only as 256-colour palettes (DIB 1000 is the main one). Quantise 8 → 6 bits per channel like the VGA DAC |
| SND | 8-bit unsigned mono PCM |
| MuV | 44 bytes: h @2, v @4, duration u32 @0x0e, rate 600 @0x12, step 60 @0x14 |
| Ply | 16-byte records: type, arg, start u32, duration u32, v i16, h i16 (Mac order). Types 3–6 draw frame `arg` at the movie position + Img(h, v), plus the record's (v, h) for 5 and 6. Type 7 plays SND `arg`. Type 10 ends the movie. Every record active at time t is drawn, in order |
| Img | 12 bytes per frame: h, v, rect l, t, r, b. Talk movies with id ≥ 10000 share the Pak and Img of 10000, 11000 or 12000 |
| XMI | XMIDI (FORM XDIR / CAT XMID / FORM XMID {TIMB, EVNT}), 120 Hz ticks, note-ons carry their duration. Played on an OPL2 with the Global Timbre Library `data/midpak.ad` (`music.js`, `opl-worklet.js`). MIDI channels 1–10 hold the OPL arrangement; 13–16 repeat it for base-level synths and are skipped |

The menu bar and its dropdowns use the BIOS 8×8 font (`js/engine/font8x8.js`).

## Where each part lives

| Part | Overlays | Port |
| --- | --- | --- |
| Logos | 7454 | `js/scenes/logos.js` |
| Title intro | 7682 | `js/scenes/intro.js` |
| Main menu | 7493 (selection 0d77, blink 13a7, idle 1074, launch 14be, greeting 1739) | `js/scenes/mainmenu.js` |
| Credits | 5fac | `js/scenes/credits.js` |
| Checkers | 659c intro; 6000 flow (6000:0b0b: start and end of a game); 617d board, animation and idle (617d:08de); 633c geometry; 63e7 move input and rules (63e7:088d); resident 1a5d Mario's search | `js/games/checkers.js` |
| Go Fish | 6f3e intro; 7000 game; 6ea7 deck and Mario's memory | `js/games/fish.js` |
| Dominoes | 6d82 intro; 6840 game (screen rects at 6840:4da7) | `js/games/dominoes.js` |
| Backgammon | 5f80 intro; 5a32 game | `js/games/backgammon.js` |
| Yacht | 7b14 intro; 7783 game; 7a78 Mario's dice planner | `js/games/yacht.js` |

## Facts to know before changing a game

**Checkers (1a5d)**:

- Mario's AI is a plain minimax over piece codes `side | 4` for a king. Side 1 is the player
  (moving up), side 2 is Mario (moving down).
- Scores: 2 per capture, +2 more for a king, 4 for a crowning, 300 for a win, and +1 at the top
  level for ending nearer the square of the player's last move.
- Jumps are forced (Options › Forced Jumps).
- Search depth is `[0xdec]` (even), taken from `[0xdee]`: +2 after the player wins, −2
  otherwise, clamped to 1..6.
- Mario plays his move through the player's own input routine, 63e7:088d.
- The intro can be skipped only with a key.

**Go Fish**:

- Mario always plays first.
- At level 2 he remembers the ranks you asked for (6ea7:047a, no duplicates) and scans that
  memory from the start (sic).
- Two places where the original hangs once the deck is empty are fixed and marked (fix).

**Yacht**: the scorecard text uses the game's own routines.

- 7783:2d41: glyph = character − 0x20.
- 2e29: centred as if every character were as wide as "Q" (frame 0x31).
- 2ccb: numbers right-justified in width − 1 characters.

## The port's engine

- **Engine** (`js/engine/engine.js`):
  - Scene lifecycle: `scene.enter()`, then `scene.tick()` once per original tick and
    `scene.render(screen)`.
  - Input: `pointerDown` / `pointerMove` / `pointerUp(x, y)` in 320×200 coordinates, and
    `key(k)`.
  - Dialogs are modal layers in `e.layers`.
  - `e.ticks(n)` and `e.sleep(ms)` are awaitables that stop when the scene changes.
- **GameBase** (`js/games/base.js`):
  - `setup({ bg, talker, captionFont, captionRect, table })`.
  - Talking: `say(i)`, `sayRandom(list)`, `sayText(text)`.
  - `wait(n)` and `playMovie(id, x, y)`.
  - The original dialogs: `dlgPlayAs`, `dlgStartOver`, `dlgPlayAgain`.
  - `onCommand(cmd)` and `drawName(x, y)`.
- **Building blocks**:
  - `e.movie(id)` returns a movie with `x`, `y`, `t`, `paused`, `hidden`, `sounds()`,
    `advanceOnce()`, `draw()` and `done`.
  - `e.sprites()` returns a sprite list with the original semantics: `create`, `show`, `hide`,
    `delete`.
  - Graphics: `e.gfx.bg(id)`, `e.gfx.text(font, str, x, y, align)`,
    `e.gfx.frameInfo(pak, frame)`.
  - Sound: `e.audio.playSnd(id)`, `e.audio.playMusic(id, loop)`.
