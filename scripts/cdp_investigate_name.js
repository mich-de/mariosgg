const fs = require('fs');
const path = require('path');
const URL = process.argv[2];
const OUT = process.argv[3];
const CDP_PORT = process.env.CDP_PORT || 9340;

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
  await sleep(22000); // full boot

  // Tap "Go Fish" (second menu item)
  const jr = await rectOf('#touchCatcher');
  const gx = jr.x + jr.width * 0.28;
  const gy = jr.y + jr.height * 0.42; // Checkers is ~0.34, Go Fish next row down
  await tap(gx, gy);
  await sleep(1500);
  await screenshot('after_gofish_tap1.png');

  // Game selection often needs a second confirm tap in the same spot
  await tap(gx, gy);
  await sleep(2500);
  await screenshot('after_gofish_tap2.png');

  // dump DOM state: any extra elements beyond our known ones? any element with focus?
  const dom = await evalJs(`JSON.stringify({
    bodyChildren: [...document.body.children].map(e => ({tag: e.tagName, id: e.id, cls: e.className, style: e.getAttribute('style')})),
    activeElement: document.activeElement ? {tag: document.activeElement.tagName, id: document.activeElement.id, type: document.activeElement.type} : null,
    inputs: [...document.querySelectorAll('input,textarea')].map(e => ({id: e.id, type: e.type, style: e.getAttribute('style'), value: e.value, visible: e.offsetParent !== null})),
    jsdosChildren: document.getElementById('jsdos') ? [...document.getElementById('jsdos').children].map(e=>({tag:e.tagName,id:e.id,cls:e.className})) : null
  }, null, 2)`);
  console.log('DOM STATE:', dom);

  await sleep(6000); // see if a name dialog appears on its own after selecting game + maybe needs more taps
  await screenshot('after_wait.png');
  const dom2 = await evalJs(`JSON.stringify({
    bodyChildren: [...document.body.children].map(e => ({tag: e.tagName, id: e.id, cls: e.className})),
    inputs: [...document.querySelectorAll('input,textarea')].map(e => ({id: e.id, type: e.type, style: e.getAttribute('style'), value: e.value, visible: e.offsetParent !== null})),
  }, null, 2)`);
  console.log('DOM STATE 2:', dom2);

  ws.close();
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
