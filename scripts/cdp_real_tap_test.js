const fs = require('fs');
const path = require('path');
const URL = process.argv[2];
const OUT = process.argv[3];
const CDP_PORT = process.env.CDP_PORT || 9342;

function rpc(ws, id, method, params) {
  return new Promise((resolve) => {
    const onMsg = (event) => {
      const msg = JSON.parse(event.data.toString());
      if (msg.id === id) { ws.removeEventListener('message', onMsg); resolve(msg); }
    };
    ws.addEventListener('message', onMsg);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function main() {
  let nextId = 1;
  const r = await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?${encodeURIComponent(URL)}`, { method: 'PUT' });
  const target = await r.json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res) => ws.addEventListener('open', res));
  const call = (method, params) => rpc(ws, nextId++, method, params || {});
  const sleep = (ms) => new Promise((r2) => setTimeout(r2, ms));
  const evalJs = async (expr) => {
    const res = await call('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    return res.result && res.result.result && res.result.result.value;
  };
  let shotN = 0;
  async function screenshot(label) {
    const res = await call('Page.captureScreenshot', { format: 'png' });
    const name = `real_${String(++shotN).padStart(2, '0')}_${label}.png`;
    fs.writeFileSync(path.join(OUT, name), Buffer.from(res.result.data, 'base64'));
    console.log('saved', name);
  }
  async function tap(x, y) {
    await call('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await sleep(80);
    await call('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }
  async function rectOf(sel) {
    const r2 = await evalJs(`JSON.stringify(document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect())`);
    return JSON.parse(r2);
  }

  await call('Page.enable');
  await call('Runtime.enable');
  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await call('Emulation.setTouchEmulationEnabled', { enabled: true });
  await call('Page.navigate', { url: URL });
  await sleep(1000);

  let br = await rectOf('#playBtn');
  await tap(br.x + br.width / 2, br.y + br.height / 2);
  console.log('tapped PLAY, waiting for boot...');
  await sleep(30000);
  await screenshot('00_menu');

  // A REAL single tap, through the page's own touch handling (not direct gameCi calls),
  // on the Go Fish row.
  const jr = await rectOf('#touchCatcher');
  const rowY = parseFloat(process.argv[4] || '99.5');
  const x = jr.x + jr.width * ((50 + (150 - 50) / 2) / 320); // center of menu row x-range
  const y = jr.y + jr.height * (rowY / 200);
  console.log('tapping row at', x, y);
  await tap(x, y);
  await sleep(3000);
  await screenshot('01_after_single_real_tap');
  await sleep(4000);
  await screenshot('02_settle');
  await sleep(6000);
  await screenshot('03_settle_more');

  ws.close();
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
