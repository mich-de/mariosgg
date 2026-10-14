const fs = require('fs');
const path = require('path');
const URL = process.argv[2];
const OUT = process.argv[3];
const CDP_PORT = process.env.CDP_PORT || 9341;

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
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      jsErrors.push(msg.params.args.map(a => a.value || a.description).join(' '));
    }
  });
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data.toString());
    if (msg.method === 'Runtime.consoleAPICalled') {
      const args = msg.params.args.map((a) => a.value !== undefined ? a.value : a.description);
      console.log('[PAGE]', ...args);
    }
  });
  const call = (method, params) => rpc(ws, nextId++, method, params || {});
  const sleep = (ms) => new Promise((r2) => setTimeout(r2, ms));
  const evalJs = async (expr) => {
    const res = await call('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    return res.result && res.result.result && res.result.result.value;
  };
  async function screenshot(name) {
    const res = await call('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, name), Buffer.from(res.result.data, 'base64'));
    console.log('saved', name);
  }
  async function tap(x, y) {
    await call('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await sleep(70);
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
  await sleep(40000);
  await screenshot('kb_00_menu.png');

  // Tap the keyboard button, then focus+dispatch real key events into #kbInput the same way
  // a soft keyboard would, and see if the game's File menu opens (its 'f' shortcut).
  const kbRect = await rectOf('#kbBtn');
  console.log('kbBtn hidden?', await evalJs(`document.getElementById('kbBtn').hidden`));
  await tap(kbRect.x + kbRect.width / 2, kbRect.y + kbRect.height / 2);
  await sleep(300);
  console.log('active element after kb tap:', await evalJs(`document.activeElement.id`));

  await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'f', code: 'KeyF', text: 'f' });
  await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'f', code: 'KeyF' });
  await sleep(1000);
  await screenshot('kb_01_after_f.png');

  console.log('JS ERRORS:', jsErrors.length ? jsErrors.join('\n---\n') : '(none)');

  ws.close();
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
