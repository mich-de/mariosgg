// node scripts/cdp_test.js <url> <outDir>
const fs = require('fs');
const path = require('path');

const URL = process.argv[2] || 'http://localhost:8099/index.html';
const OUT = process.argv[3] || path.resolve(__dirname, '../screenshots');
const CDP_PORT = process.env.CDP_PORT || 9333;

function rpc(ws, id, method, params, sessionId) {
  return new Promise((resolve) => {
    const onMsg = (event) => {
      const msg = JSON.parse(event.data.toString());
      if (msg.id === id) { ws.removeEventListener('message', onMsg); resolve(msg); }
    };
    ws.addEventListener('message', onMsg);
    ws.send(JSON.stringify({ id, method, params, sessionId }));
  });
}

async function main() {
  let nextId = 1;
  const r = await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?${encodeURIComponent(URL)}`, { method: 'PUT' });
  const target = await r.json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res) => ws.addEventListener('open', res));

  const call = (method, params) => rpc(ws, nextId++, method, params || {});
  await call('Page.enable');
  await call('Runtime.enable');

  async function screenshot(name) {
    const res = await call('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, name), Buffer.from(res.result.data, 'base64'));
    console.log('saved', name);
  }
  async function evalJs(expr) {
    const res = await call('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    return res.result && res.result.result && res.result.result.value;
  }
  const sleep = (ms) => new Promise((r2) => setTimeout(r2, ms));
  async function rectOf(sel) {
    const r = await evalJs(`JSON.stringify(document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect())`);
    return JSON.parse(r);
  }
  async function click(x, y) {
    await call('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  }
  async function tap(x, y) {
    const pts = [{ x, y }];
    await call('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts });
    await sleep(60);
    await call('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }

  // ---------- DESKTOP PASS ----------
  await call('Emulation.setDeviceMetricsOverride', { width: 1024, height: 640, deviceScaleFactor: 1, mobile: false });
  await call('Page.navigate', { url: URL });
  await sleep(1500);
  await screenshot('desk_01_launcher.png');

  let br = await rectOf('#playBtn');
  await click(Math.floor(br.x + br.width / 2), Math.floor(br.y + br.height / 2));
  await sleep(1800);
  await screenshot('desk_02_afterplay.png');
  await sleep(20000);
  await screenshot('desk_03_booted.png');

  // click where "Checkers" sits in the menu list (roughly left-third, upper area per earlier probe)
  const r1 = await evalJs(`(() => { const el = document.getElementById('jsdos'); const r = el.getBoundingClientRect(); return JSON.stringify(r); })()`);
  console.log('jsdos rect', r1);
  const rect = JSON.parse(r1);
  const cx = rect.x + rect.width * 0.28;
  const cy = rect.y + rect.height * 0.34;
  await click(cx, cy);
  await sleep(2500);
  await screenshot('desk_04_afterclick.png');

  // ---------- MOBILE/TOUCH PASS ----------
  await call('Page.navigate', { url: URL });
  await sleep(500);
  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await call('Emulation.setTouchEmulationEnabled', { enabled: true });
  await sleep(1000);
  await screenshot('mob_01_launcher.png');

  br = await rectOf('#playBtn');
  await tap(Math.floor(br.x + br.width / 2), Math.floor(br.y + br.height / 2));
  await sleep(2500);
  await screenshot('mob_02_afterplay.png');
  await sleep(20000);
  await screenshot('mob_03_booted.png');

  const r2 = await evalJs(`(() => { const el = document.getElementById('jsdos'); const r = el.getBoundingClientRect(); return JSON.stringify(r); })()`);
  console.log('jsdos rect (mobile)', r2);
  const rectM = JSON.parse(r2);
  const mx = rectM.x + rectM.width * 0.28;
  const my = rectM.y + rectM.height * 0.34;
  await tap(mx, my);
  await sleep(2500);
  await screenshot('mob_04_aftertap.png');

  ws.close();
  console.log('done');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
