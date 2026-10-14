<div align="center">

# 🎩 Mario's Game Gallery

**Play the 1995 Interplay/Presage DOS classic right in your browser — desktop or mobile.**

[🇮🇹 Leggi in italiano](README.it.md)

![DOSBox](https://img.shields.io/badge/engine-js--dos%20%2F%20DOSBox-blue)
![Platform](https://img.shields.io/badge/platform-browser-success)
![Touch](https://img.shields.io/badge/mobile-touch%20ready-orange)

<img src="screenshots/launcher.png" width="520" alt="Mario's Game Gallery title screen">

</div>

## What is this

Mario, in top hat and tails, hosts five parlor games on a little painted easel:
**Checkers, Go Fish, Dominoes, Backgammon** and **Yacht**. Released by Interplay
in February 1995, it runs here unmodified inside [js-dos](https://js-dos.com/),
a DOSBox build compiled to WebAssembly — no plugin, no download, no install.

## Play

Open the GitHub Pages link above (or `index.html` if you cloned this repo) and
hit **PLAY**. That's it.

- **Desktop:** move the mouse, click to select — exactly like 1995.
- **Mobile:** tap where you want Mario's hand to point, drag to move game
  pieces. The page translates every tap straight into DOS mouse events, so
  there is no on-screen joystick getting in the way of the board.
- Tap/click the ⛶ button (top-left) for full screen.

## Screenshots

<p align="center">
  <img src="screenshots/desktop.png" width="400" alt="Desktop, main menu">
  <img src="screenshots/mobile_touch.png" width="220" alt="Mobile, main menu, portrait">
</p>

## How it's built

- The original floppy image (`mariosgg/`) is packed into a single `mariosgg.jsdos`
  bundle together with a `dosbox.conf` (Sound Blaster, max cycles).
- `index.html` boots it with [js-dos](https://js-dos.com/) v8 in kiosk mode and
  wires its own pointer layer straight to the DOS mouse (`sendMouseMotion` /
  `sendMouseButton`), using the same absolute, letterbox-aware coordinate math
  js-dos itself uses internally — so the exact same code path drives a
  hovering desktop mouse and a tapping, dragging touch screen.
- The bundle is re-fetched (and the browser's stale copy evicted) whenever its
  ETag changes, so a new deploy reaches returning players without a manual
  cache clear.

## Credits

*Mario's Game Gallery* © 1995 Interplay Entertainment / Presage Software, made
under license from Nintendo. Shared here unmodified for preservation; this
project is not affiliated with Interplay, Presage or Nintendo.

---

<div align="center">

🤖 Built with [Claude Code](https://claude.com/claude-code)

</div>
