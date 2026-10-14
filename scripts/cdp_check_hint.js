const fs = require('fs');
const path = require('path');
const URL = process.argv[2];
const OUT = process.argv[3];
const CDP_PORT = process.env.CDP_PORT || 9336;

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
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data.toString());
    if (msg.method === 'Runtime.consoleAPICalled') {
      const args = msg.params.args.map((a) => a.value !== undefined ? a.value : (a.preview ? JSON.stringify(a.preview.properties.reduce((o, p) => (o[p.name] = p.value, o), {})) : a.description));
      console.log('[PAGE]', ...args);
    }
  });
  const call = (method, params) => rpc(ws, nextId++, method, params || {});
  const sleep = (ms) => new Promise((r2) => setTimeout(r2, ms));
  const evalJs = async (expr) => {
    const res = await call('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    return res.result && res.result.result && res.result.result.value;
  };

  await call('Page.enable');
  await call('Runtime.enable');
  if (process.env.SIMULATE_IOS) {
    await call('Page.addScriptToEvaluateOnNewDocument', {
      source: `
        Object.defineProperty(document, 'fullscreenEnabled', { value: false, configurable: true });
        document.documentElement.requestFullscreen = undefined;
      `,
    });
  }
  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await call('Emulation.setTouchEmulationEnabled', { enabled: true });
  await call('Page.navigate', { url: URL });
  await sleep(1200);

  let br = JSON.parse(await evalJs(`JSON.stringify(document.querySelector('#playBtn').getBoundingClientRect())`));
  await call('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: br.x + br.width / 2, y: br.y + br.height / 2 }] });
  await sleep(60);
  await call('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(20000);

  const state = await evalJs(`JSON.stringify({
    coarse: matchMedia("(pointer: coarse)").matches,
    fine: matchMedia("(pointer: fine)").matches,
    maxTouchPoints: navigator.maxTouchPoints,
    hintHidden: document.getElementById("rotateHint").hidden,
    hintDisplay: getComputedStyle(document.getElementById("rotateHint")).display,
    hintRect: document.getElementById("rotateHint").getBoundingClientRect(),
    innerWidth, innerHeight,
    fsEnabled: document.fullscreenEnabled,
  })`);
  console.log('STATE', state);

  const res = await call('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT, 'hint_check.png'), Buffer.from(res.result.data, 'base64'));
  console.log('saved hint_check.png');

  ws.close();
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
