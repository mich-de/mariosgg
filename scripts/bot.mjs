// Touch-only autoplay (regression test): launches every game from the main menu and plays it to the end with
// emulated touch taps (mobile viewport), at ?speed=N. Usage: node scripts/bot.mjs OUTDIR [games] [speed]
import { session } from "./cdp.mjs";
import fs from "fs";

const OUT = process.argv[2];
const GAMES = (process.argv[3] || "checkers,fish,dominoes,backgammon,yacht").split(",");
const SPEED = +(process.argv[4] || 8);
const BTN_Y = { checkers: 77, fish: 93, dominoes: 108, backgammon: 123, yacht: 138 };
const CLS = { checkers: "Checkers", fish: "Fish", dominoes: "Dominoes", backgammon: "Backgammon", yacht: "Yacht" };

const BOT = `(() => {
  const e = window.__mgg, sc = e.scene, L = e.layers[e.layers.length - 1];
  const B = window.__bot || (window.__bot = {});
  const r = (n) => Math.floor(Math.random() * n);
  if (L) {
    const ln = L.constructor.name;
    if (ln === "NameDialog" && B.typeName && !B.typed) {
      B.typed = true;
      return { x: 150, y: 115, why: "name field", then: "type" };
    }
    if (ln === "NameDialog" || ln === "PakDialog") {
      let b = L.buttons[0];
      if (L.pakId === 106) b = L.buttons[1]; // play again? -> NO (back to the menu)
      const f = e.gfx.frameInfo(L.pakId, b.frame);
      return { x: L.x + b.x + (f.w >> 1), y: L.y + b.y + (f.h >> 1), why: ln + " " + L.pakId };
    }
    return { wait: ln };
  }
  const n = sc.constructor.name;
  if (n === "Checkers") {
    if (!sc.ready || sc.inModal) return { wait: "ck" };
    if (sc.over || !(sc.flags & 1) || sc.talker.talking || sc.ist2 !== 0 || (sc.flags & (0x10 | 0x40 | 8 | 4 | 0x20 | 0x80)))
      return { wait: "ck " + sc.st + "/" + sc.ist2 + "/" + sc.flags };
    if (sc.sel === 0xc8 || !B.path || B.i >= B.path.length) {
      const ms = sc.legalMoves();
      if (!ms.length) return { wait: "nomove" };
      B.path = ms[r(ms.length)];
      B.i = 0;
    }
    const [c, rr] = B.path[B.i++];
    const cl = sc.cell(c, rr);
    if (cl.owner !== 2) {
      const p = sc.pieceAt(cl), f = e.gfx.frameInfo(2501, p.frame);
      return { x: p.x + f.x + (f.w >> 1), y: p.y + f.y + (f.h >> 1), why: "ck piece " + c + "," + rr };
    }
    const f = e.gfx.frameInfo(2500, cl.frame);
    return { x: cl.hx + f.x + (f.w >> 1), y: cl.hy + f.y + (f.h >> 1), why: "ck to " + c + "," + rr };
  }
  if (n === "Fish") {
    if (!sc.ready || sc.inModal) return { wait: "fish" };
    const needPile = sc.fst === 0 && !(sc.flags & 1) && ((sc.turn === 2 && (sc.pst === 2 || sc.pst === 32)) || (sc.turn === 3 && sc.mst === 2));
    if (needPile) return { x: 229, y: 97, why: "fish" };
    if (sc.turn === 2 && (sc.flags & 8) && sc.choice === -1) {
      const ks = sc.slots.map((s, k) => (s.vis ? k : -1)).filter((k) => k >= 0);
      if (!ks.length) return { wait: "noslot" };
      const k = ks[r(ks.length)];
      return { x: sc.slots[k].x + 14, y: sc.slots[k].y + 20, why: "ask slot " + k };
    }
    return { wait: "fish " + sc.turn + "/" + sc.pst + "/" + sc.mst };
  }
  if (n === "Dominoes") {
    if (sc.state === "player") {
      const c = sc.candidates(sc.hand);
      if (!c.length) return { x: 306, y: 170, why: "boneyard" };
      const k = c[r(c.length)];
      B.side = k.side; B.i = k.i;
      return { x: k.i * 17 + 3 + 8, y: 154 + 16, why: "pick " + k.i };
    }
    if (sc.state === "held") {
      if (!sc.ends) return { x: 160, y: 80, why: "first" };
      const e = sc.ends[B.side || "L"];
      return { x: Math.max(4, Math.min(316, e.x)), y: Math.max(12, Math.min(149, e.y)), why: "drop " + B.side };
    }
    return { wait: sc.state };
  }
  if (n === "Yacht") {
    if (sc.whose !== "p" || sc.busyTalk) return { wait: sc.state };
    if (sc.state === "roll") return { x: 262, y: 186, why: "roll" };
    if (sc.state !== "choose") return { wait: sc.state };
    const free = sc.card.p.map((v, k) => (v === null ? k : -1)).filter((k) => k >= 0);
    if (sc.rolls > 0 && Math.random() < 0.5) {
      if (Math.random() < 0.6) { const k = r(5); return { x: 103 + 23 * k + 10, y: sc.dice[k].kept ? 164 : 154, why: "keep " + k }; }
      if (sc.dice.some((d) => !d.kept)) return { x: 262, y: 186, why: "reroll" };
    }
    const row = free[r(free.length)];
    return { x: 268, y: 29 + 11 * row + 5, why: "score " + row };
  }
  if (n === "Backgammon") {
    const HX = [26,47,67,87,108,128,172,193,213,234,254,274,292,268,244,221,197,174,124,100,77,53,29,7];
    const P = (i) => ({ x: HX[i] + 10, y: i < 12 ? 115 : 165 });
    if (sc.whose !== "p") return { wait: sc.state };
    if (sc.state === "roll") return { x: 300, y: 40, why: "roll" };
    if (sc.state !== "move" || sc.walkMv || sc.talker.talking || sc.confirmed) return { wait: sc.state };
    if (sc.sel === null) {
      if (sc.barStack.p.length) return { x: 157, y: 160, why: "bar" };
      const srcs = [];
      for (let i = 0; i < 24; i++) if (sc.canMoveFrom(i)) srcs.push(i);
      if (!srcs.length) return { wait: "nosrc" };
      return { ...P(srcs[r(srcs.length)]), why: "src" };
    }
    const ts = [];
    for (let t = 0; t < 24; t++) if ((t > sc.src || sc.sel === -1) && sc.legalTarget(t)) ts.push(t);
    if (sc.sel >= 0 && sc.bearDie() >= 0 && (!ts.length || Math.random() < 0.5)) return { x: 26, y: 140, why: "off" };
    if (!ts.length) return { ...P(sc.src), why: "deselect" };
    return { ...P(ts[r(ts.length)]), why: "to" };
  }
  return { wait: n };
})()`;

const s = await session({ mobile: true, width: 844, height: 390 });
const touch = async (x, y) => {
  const [cx, cy] = await s.toClient(x, y);
  await s.call("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: cx, y: cy }] });
  await s.sleep(40);
  await s.call("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
};
const scene = () => s.eval("window.__mgg.scene.constructor.name");
const report = {};
try {
  await s.open(`index.html?debug&autostart&speed=${SPEED}&scene=menu`, 2500);
  let first = true;
  for (const g of GAMES) {
    const t0 = Date.now();
    while ((await scene()) !== "MainMenu" && Date.now() - t0 < 20000) await s.sleep(200);
    await s.sleep(800);
    await s.eval(`window.__bot = { typeName: ${first} }`);
    await touch(90, BTN_Y[g] + 6);
    let steps = 0, taps = 0, last = "", stuck = 0, seen = false, outcome = "timeout";
    const tg = Date.now();
    while (Date.now() - tg < 300000) {
      const n = await scene();
      if (n === CLS[g]) seen = true;
      if (seen && n === "MainMenu") { outcome = "back to menu"; break; }
      const a = await s.eval(BOT);
      steps++;
      if (a.x !== undefined) {
        await touch(a.x, a.y);
        taps++;
        if (taps === 12 || taps === 30) { await s.sleep(400); await s.fb(`${OUT}/mid_${g}_${taps}.png`); }
        if (a.then === "type") {
          await s.sleep(150);
          const focused = await s.eval("document.activeElement && document.activeElement.id");
          await s.call("Input.insertText", { text: "Luigi" });
          await s.sleep(150);
          console.log(`  name field focused=${focused}, dialog text=${await s.eval("window.__mgg.layers.at(-1).text")}`);
        }
        const k = a.why;
        if (k === last) stuck++; else stuck = 0;
        last = k;
        if (stuck > 40) { outcome = "stuck on " + k; break; }
      }
      await s.sleep(a.x !== undefined ? 120 : 200);
    }
    first = false;
    const st = await s.eval(`(() => { const sc = window.__mgg.scene; return JSON.stringify({ name: window.__mgg.prefs.name, state: sc.state, layers: window.__mgg.layers.map(l => l.constructor.name) }); })()`);
    report[g] = { outcome, secs: Math.round((Date.now() - tg) / 1000), steps, taps, st };
    console.log(g, JSON.stringify(report[g]));
    if (outcome !== "back to menu") await s.fb(`${OUT}/bot_${g}.png`);
    const errs = s.logs.filter((l) => /^(EXC|error)/.test(l));
    if (errs.length) console.log("  errors:", errs.join("\n"));
  }
} finally {
  fs.writeFileSync(`${OUT}/bot_report.json`, JSON.stringify(report, null, 1));
  s.close();
}
