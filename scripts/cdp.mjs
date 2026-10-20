// Minimal headless-Chrome driver for testing the native build (no Puppeteer dependency).
// Usage: import { session } from "./cdp.mjs"; const s = await session({ mobile: false });
//   await s.open("index.html?debug&autostart"); await s.fb("out.png"); await s.tap(160, 100); s.close();
import { spawn } from "child_process";
import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".png": "image/png", ".css": "text/css", ".gz": "application/gzip", ".json": "application/json" };

function serve(port) {
  const srv = http.createServer((req, res) => {
    const u = decodeURIComponent(new URL(req.url, "http://x").pathname);
    let f = path.join(ROOT, u === "/" ? "index.html" : u);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
      res.writeHead(404);
      return res.end("not found");
    }
    const data = fs.readFileSync(f);
    res.writeHead(200, { "content-type": TYPES[path.extname(f)] || "application/octet-stream", "content-length": data.length, "cache-control": "no-store" });
    res.end(data);
  });
  return new Promise((r) => srv.listen(port, "127.0.0.1", () => r(srv)));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function session(opts = {}) {
  const port = opts.port || 8123 + Math.floor(Math.random() * 500);
  const cdpPort = opts.cdpPort || 9400 + Math.floor(Math.random() * 500);
  const srv = await serve(port);
  const udd = fs.mkdtempSync("/tmp/mgg-chrome-");
  const chrome = spawn("google-chrome-stable", [
    "--headless=new", `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${udd}`,
    "--no-first-run", "--no-default-browser-check", "--autoplay-policy=no-user-gesture-required",
    "--disable-gpu", "--mute-audio", "about:blank",
  ], { stdio: "ignore" });
  let target;
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${cdpPort}/json/list`);
      const list = await r.json();
      target = list.find((t) => t.type === "page");
      if (target) break;
    } catch (e) {}
    await sleep(200);
  }
  if (!target) throw new Error("chrome did not start");
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r));
  let id = 0;
  const pending = new Map();
  const logs = [];
  ws.addEventListener("message", (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
    } else if (m.method === "Runtime.exceptionThrown") logs.push("EXC " + JSON.stringify(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
    else if (m.method === "Runtime.consoleAPICalled") logs.push(m.params.type + " " + m.params.args.map((a) => a.value ?? a.description).join(" "));
  });
  const call = (method, params = {}) => new Promise((r) => {
    const i = ++id;
    pending.set(i, r);
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  await call("Page.enable");
  await call("Runtime.enable");
  const mobile = !!opts.mobile;
  if (mobile) {
    await call("Emulation.setDeviceMetricsOverride", { width: opts.width || 844, height: opts.height || 390, deviceScaleFactor: 2, mobile: true });
    await call("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
  } else {
    await call("Emulation.setDeviceMetricsOverride", { width: opts.width || 1024, height: opts.height || 768, deviceScaleFactor: 1, mobile: false });
  }
  const s = {
    logs,
    call,
    async open(rel, wait = 2500) {
      await call("Page.navigate", { url: `http://127.0.0.1:${port}/${rel}` });
      await sleep(wait);
    },
    async eval(expr) {
      const r = await call("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
      if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text));
      return r.result?.result?.value;
    },
    async shot(file) {
      const r = await call("Page.captureScreenshot", { format: "png" });
      fs.writeFileSync(file, Buffer.from(r.result.data, "base64"));
    },
    // Exact 320x200 framebuffer as PNG.
    async fb(file) {
      const url = await s.eval("(() => { const e = window.__mgg; e.render(); return e.screen.off.toDataURL('image/png'); })()");
      fs.writeFileSync(file, Buffer.from(url.split(",")[1], "base64"));
    },
    async toClient(x, y) {
      const r = JSON.parse(await s.eval("JSON.stringify(document.getElementById('screen').getBoundingClientRect())"));
      return [r.left + ((x + 0.5) / 320) * r.width, r.top + ((y + 0.5) / 200) * r.height];
    },
    async tap(x, y, hold = 60) {
      const [cx, cy] = await s.toClient(x, y);
      if (mobile) {
        await call("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: cx, y: cy }] });
        await sleep(hold);
        await call("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      } else {
        await call("Input.dispatchMouseEvent", { type: "mouseMoved", x: cx, y: cy });
        await call("Input.dispatchMouseEvent", { type: "mousePressed", x: cx, y: cy, button: "left", clickCount: 1 });
        await sleep(hold);
        await call("Input.dispatchMouseEvent", { type: "mouseReleased", x: cx, y: cy, button: "left", clickCount: 1 });
      }
    },
    async move(x, y) {
      const [cx, cy] = await s.toClient(x, y);
      await call("Input.dispatchMouseEvent", { type: "mouseMoved", x: cx, y: cy });
    },
    async key(key, code = key) {
      await call("Input.dispatchKeyEvent", { type: "keyDown", key, code, text: key.length === 1 ? key : undefined });
      await call("Input.dispatchKeyEvent", { type: "keyUp", key, code });
    },
    sleep,
    close() {
      try { ws.close(); } catch (e) {}
      chrome.kill("SIGKILL");
      srv.close();
      try { fs.rmSync(udd, { recursive: true, force: true }); } catch (e) {}
    },
  };
  return s;
}

// CLI: node scripts/cdp.mjs "<url-path>" out.png [waitMs]
if (process.argv[1] && process.argv[1].endsWith("cdp.mjs") && process.argv[2]) {
  const s = await session({ mobile: process.env.MOBILE === "1" });
  try {
    await s.open(process.argv[2], +(process.argv[4] || 3000));
    if (process.argv[2].includes("debug")) await s.fb(process.argv[3]);
    else await s.shot(process.argv[3]);
    console.log(s.logs.join("\n"));
  } finally {
    s.close();
  }
}
