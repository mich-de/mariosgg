# Mario's Game Gallery (1995) — reverse-engineering reconstruction

Status: in progress. This directory contains only pieces backed by verified evidence
(either a 100%-consistent statistical match against the full resource corpus, or a
decompiled function read directly off the binary). Nothing here is a guess or a stub.

## Target

- `setup.exe` (47,524 bytes): DOS MZ, Borland C++, uses the "Window BOSS" text-mode
  window library (string evidence at file offset 0x1_eca3: `"The Window BOSS (V6.01)..."`).
  It is a sound-card configurator (writes `intrplay.cfg`); it has no overlay segment and
  no embedded archive. Nothing to extract from it.
- `mario.exe` (402,576 bytes): DOS MZ, Borland C++, uses a Borland VROOMM-style overlay
  manager — `FBOV` signature at file offset 0x40190. This is the actual game engine.
- `mario.prs` (6,131,939 bytes): proprietary resource archive holding every sprite,
  sound, music track and animation-timing table.

## mario.exe overlay format (evidence: byte-level, cross-checked against the segment table)

```
MZ load module [hdr .. modend)
at modend:  "FBOV" u32 ovrsize  u32 segtab_file_off  u32 segcount   (16-byte header)
segment table (segtab_file_off, in-module offset): segcount x 8 bytes:
    u16 para, u16 size, u16 kind, u16 lowofs      (kind: 0 data, 1 code, 3 overlay-stub, 4 stack/bss)
overlay stub segment (kind 3, at para*16 in the module):
    +00 CD 3F              INT 3Fh overlay-manager call signature
    +02 u16 0
    +04 u32 file offset of this overlay's data inside the overlay area
    +08 u16 code size
    +0A u16 relocation-table size (bytes)
    +0C u16 entry (thunk) count
    +0E..1F  zero
    +20  entry_count * 5 bytes: CD 3F <u16 offset into overlay code> 00   (one thunk per entry point)
overlay data (at modend+16+fileofs): code bytes, then a relocation table of u16 offsets;
each relocated word in the overlay code holds (segment_table_index * 8); the resolved
paragraph is segment_table[index].para.
```

mario.exe has 133 segment-table entries, 31 of which are overlay stubs. All 2900 overlay-
internal fixups and all 505 thunk entries were decoded and validated (every fixup's value is
a multiple of 8 addressing a valid table index; every thunk's `CD 3F` prologue matched before
patching). `tools/unoverlay.py` rebuilds a single flat, overlay-free MZ (`mario_unified.exe`)
for static analysis, laying out every frame so none straddles a 64 KiB real-mode segment
boundary (the naive concatenation initially used broke Ghidra's near-branch resolution for
code crossing that boundary — this version fixes that by padding to the next 0x1000-paragraph
slot whenever a frame would otherwise straddle it).

## mario.prs container format (evidence: parses 1806/1806 records, 0 mismatches against mario.prd)

```
offset 0x00  "PRS Format Resource File\r\n" + zero padding + 0x1A     (0x30 bytes)
offset 0x30  repeated record:
    +0x00 char[4]   type tag, NUL terminated: Ply | MuV | SND | Pak | Img | XMI | DIB
    +0x04 u16       resource id (not unique alone — unique per (tag, id) pair)
    +0x06 char[18]  name, NUL padded
    +0x18 u32       record length including this 28-byte header
    +0x1C ...       payload (length - 0x1C bytes)
```

1806 resources total: Ply 574, MuV 574, SND 278, Pak 187, Img 177, XMI 12, DIB 4.
`tools/prs_extract.py` splits the archive into per-resource files plus an index.

## Resource sub-formats

| Tag | Status | Evidence |
|-----|--------|----------|
| SND | **Decoded, 100% verified** | `u16 flag(=3), u16 dataLen, u16 sampleRateHz` + raw 8-bit unsigned mono PCM. Checked against all 278 SND records: `flag==3` and `dataLen==payload.length-6` in every single one, with no exceptions. Implemented in `engine/snd.js`. |
| DIB | **Decoded, verified** | Standard Windows BMP, 8bpp, used only to carry a 256-entry color table (`biBitCount==8`; the pixel data itself is a throwaway 1x1 image). Implemented in `engine/palette.js`. |
| XMI | **Identified, standard format — no RE needed** | Miles Design XMIDI (`FORM`/`CAT `/`XMID` chunks, confirmed by file magic), played through the AIL driver chain (`MIDPAK.COM`, `ADLIB.COM`/`SB*.COM`). This is a documented public format; only a converter is needed, not reverse engineering. |
| Img | **Structure identified, not yet wired into a decoder** | 12-byte records, 6 x u16 (little-endian): `(ax, ay, 0, 0, width, height)`. `width`/`height` match the corresponding Pak frame's header exactly across the whole corpus (spot-checked cross-field, not yet batch-verified on all 177 Img resources). |
| Pak | **Decoded and verified, main variant (`ver` high bit clear)** | Container (`frameCount x u32` offset table after a 6-byte header) confirmed by decompiling `FUN_35a7_0b90`. Per-frame RLE codec confirmed by reading the raw assembly of `FUN_1d4e_0004` instruction-by-instruction (the decompiled C for this one was unreliable — it lost track of two registers across the loop). Implemented in `engine/pak.js`. Validated against all 187 extracted Pak resources: 142/187 (3633 frames) decode cleanly to plausible dimensions and render as correct, cleanly-masked sprite art when checked visually (e.g. the Checkers Koopa/Yoshi piece sheets, id 2800/2801) against the known palette. The other 45 all have `ver` with bit 15 set (`0x8002` instead of `0x0002`) — a distinct sub-format (likely full-screen "PEL" stills rather than animation frames) that is **not yet decoded**; `decodePak`/`decodePakFrame` only handle the main variant and will produce garbage if pointed at one of these without checking `ver` first (not currently checked — callers must avoid the 45 listed `ver=0x8002` resources until that variant is traced). |
| Ply | **Field layout identified, semantics partial** | 16-byte records: `u16 type(=4), u16 seq, u32 startTick, u32 durationTick, u32 pad(=0)`. `seq` increments per record; `startTick` is cumulative. Not yet cross-checked against the actual animation player code. |
| MuV | **Not decoded** | Two size classes observed (44 bytes and 1024 bytes). Some fixed-position fields are constant across the whole 44-byte class (always `600`, always `60` at fixed offsets) suggesting a tick-rate constant, but the meaning of the record as a whole is unconfirmed. No decoder will be written until this is backed by decompiled evidence. |

## Resource-manager architecture (evidence: decompiled call chain, mario_unified.exe)

Every resource type funnels through one generic cache: `FUN_333c_2210(tagOffset, id)` — a
thin wrapper that hashes into a per-type descriptor table (`FUN_333c_0229`/`_0d06`) and, on a
cache miss, calls `FUN_333c_0627` to open `mario.prs`, seek to the resource's recorded file
offset (`FUN_333c_0243`, itself wrapping `FileOpen`/`FileSeek`/`FileClose`-style thunks at
`FUN_6dfd_0172`/`_0383`/`_0430`), and read its raw bytes (`FUN_6dfd_01e0`, a chunked
`FileRead` capped at `0xFFF0` bytes per call — the classic DOS <64KB-read-per-call limit).
Pak resources additionally have a specialised partial loader, `FUN_35a7_0b90`, that reads just
the 6-byte header plus the frame-offset table and then seeks/reads only the specific frames
requested, rather than pulling the whole resource into memory — this is the function whose
frame-table parsing is the direct source for the Pak container format below. Pak frames are
drawn through `FUN_35a7_0ead`, which bounds-checks/clips the sprite against the destination
rect and picks one of four leaf blitters (`FUN_1d4e_0004`/`_00b5`/`_0161`/`_031f` — unclipped
vs. clipped, crossed with normal vs. a `param_10`-selected variant, most likely horizontal
flip, not yet confirmed) — `FUN_1d4e_0004` (unclipped, non-flipped) is the one whose raw
assembly is the source for the RLE codec in `engine/pak.js`.

## What's still missing for a full engine

The actual per-game state machines (Checkers/dominoes/backgammon/etc. rules, turn flow), input
handling (mouse/keyboard mapping — already independently reverse engineered this session for
the DOSBox build, see the project memory notes, but not yet tied to decompiled evidence here),
on-screen rendering to the VGA framebuffer, and the Img/Ply/MuV resource semantics are not
traced yet. Each one needs the same evidence-first treatment as Pak got: find the real call
site, decompile or disassemble it, confirm it against data before writing a line of JS.

## Design decision: assets stay in the original container at runtime

This reconstruction's renderer parses `mario.prs` directly (client-side, same as the existing
js-dos build already ships the original game data). It does not bulk-convert and commit all
1806 resources as standalone decoded files — `mario.prs` is a commercial 1995 title's asset
archive (unlike the OMF2097 project, this game is not freeware), and shipping a copy of the
*original* data file for an engine to read is the same posture the existing DOSBox build
already has, whereas republishing every individual sprite/sound as separate converted files
would be a materially larger-scale redistribution of that archive's contents. Everything
in `analysis/` (raw per-resource dumps used only to study the formats) stays local and is
git-ignored.
