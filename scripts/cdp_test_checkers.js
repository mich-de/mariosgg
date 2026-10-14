const fs = require('fs');
const path = require('path');
const URL = process.argv[2] || 'http://localhost:8099/checkers.html';
const OUT = process.argv[3] || 'screenshots';
const CDP_PORT = process.env.CDP_PORT || 9345;
const MOBILE = process.env.MOBILE === '1';

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
  const jsErrors = [];
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data.toString());
    if (msg.method === 'Runtime.exceptionThrown') jsErrors.push(JSON.stringify(msg.params.exceptionDetails));
  });
  const call = (method, params) => rpc(ws, nextId++, method, params || {});
  const sleep = (ms) => new Promise((r2) => setTimeout(r2, ms));
  const evalJs = async (expr) => {
    const res = await call('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    return res.result && res.result.result && res.result.result.value;
  };
  let shotN = 0;
  async function screenshot(label) {
    const res = await call('Page.captureScreenshot', { format: 'png' });
    const name = `chk_${String(++shotN).padStart(2, '0')}_${label}.png`;
    fs.writeFileSync(path.join(OUT, name), Buffer.from(res.result.data, 'base64'));
    console.log('saved', name);
  }
  async function tap(x, y) {
    if (MOBILE) {
      await call('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      await sleep(60);
      await call('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else {
      await call('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
      await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    }
  }
  async function rectOf(sel) {
    const r2 = await evalJs(`JSON.stringify(document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect())`);
    return JSON.parse(r2);
  }

  await call('Page.enable');
  await call('Runtime.enable');
  if (MOBILE) {
    await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await call('Emulation.setTouchEmulationEnabled', { enabled: true });
  } else {
    await call('Emulation.setDeviceMetricsOverride', { width: 1024, height: 768, deviceScaleFactor: 1, mobile: false });
  }
  await call('Page.navigate', { url: URL });
  await sleep(1500);
  await screenshot('initial');

  const br = await rectOf('#board');
  const sq = br.width / 8;
  const squareCenter = (r0, c0) => [br.x + c0 * sq + sq / 2, br.y + r0 * sq + sq / 2];

  // Tap a player piece at row 5, col 0 (bottom-left playable square) to select it.
  let [x, y] = squareCenter(5, 0);
  await tap(x, y);
  await sleep(400);
  await screenshot('selected');

  // Tap destination row 4, col 1 (one of its two legal forward squares).
  [x, y] = squareCenter(4, 1);
  await tap(x, y);
  await sleep(1500);
  await screenshot('after_move');

  // Wait for AI turn to complete.
  await sleep(2000);
  await screenshot('after_ai');

  console.log('JS ERRORS:', jsErrors.length ? jsErrors.join('\n---\n') : '(none)');
  ws.close();
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
