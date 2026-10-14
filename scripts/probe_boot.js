const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
require(path.join(ROOT, 'node_modules/emulators/dist/emulators.js'));
globalThis.emulators.pathPrefix = path.join(ROOT, 'node_modules/emulators/dist') + '/';

// Node has no DOM; `emulators` builds a browser ImageData for screenshot(). Minimal stand-in.
globalThis.ImageData = class ImageData {
  constructor(data, width, height) {
    this.data = data;
    this.width = width;
    this.height = height;
  }
};

// Node's fs.readFileSync returns small files as views on a shared 64KB pool buffer;
// `emulators` reads the whole underlying ArrayBuffer, so every small file must be copied.
function getFilesRecursive(dir, base) {
  let res = [];
  for (const item of fs.readdirSync(dir)) {
    const full = path.join(dir, item);
    const rel = base ? base + '/' + item : item;
    if (fs.statSync(full).isDirectory()) {
      res = res.concat(getFilesRecursive(full, rel));
    } else {
      res.push({ path: rel, contents: new Uint8Array(fs.readFileSync(full)) });
    }
  }
  return res;
}

async function main() {
  const gameFiles = getFilesRecursive(path.join(ROOT, '_source/mariosgg'), 'mariosgg');
  console.log(`Loaded ${gameFiles.length} files`);

  const config = {
    dosboxConf: `
[cpu]
cycles=max

[sblaster]
sbtype=sb16
sbbase=220
irq=7
dma=1
hdma=5

[autoexec]
mount c .
c:
cd mariosgg
mario.exe
`,
    jsdosConf: { version: '8' },
  };

  const ci = await globalThis.emulators.dosboxNode([config, ...gameFiles]);
  ci.events().onStdout((msg) => console.log('[DOS]', msg));
  ci.events().onMessage((type, ...args) => console.log('[MSG]', type, ...args));

async function snap(ci, label) {
  const width = ci.width();
  const height = ci.height();
  const rgba = await ci.screenshot();
  const data = rgba.data || rgba;
  if (data && width > 0 && height > 0) {
    const header = `P6\n${width} ${height}\n255\n`;
    const rgbBuf = Buffer.alloc(width * height * 3);
    for (let i = 0; i < width * height; i++) {
      rgbBuf[i * 3 + 0] = data[i * 4 + 0];
      rgbBuf[i * 3 + 1] = data[i * 4 + 1];
      rgbBuf[i * 3 + 2] = data[i * 4 + 2];
    }
    const out = path.join(ROOT, 'screenshots', `probe_${label}.ppm`);
    fs.writeFileSync(out, Buffer.concat([Buffer.from(header), rgbBuf]));
    console.log('Saved', out, `${width}x${height}`);
  }
}

  const schedule = (process.argv[2] || '2000,5000,10000,15000,20000,26000').split(',').map(Number);
  let elapsed = 0;
  for (const t of schedule) {
    await new Promise((r) => setTimeout(r, t - elapsed));
    elapsed = t;
    await snap(ci, String(t).padStart(6, '0'));
  }

  // Try a left click near screen centre, in case the intro is waiting on input.
  ci.sendMouseMotion(0.5, 0.85);
  ci.sendMouseButton(0, true);
  await new Promise((r) => setTimeout(r, 200));
  ci.sendMouseButton(0, false);
  await new Promise((r) => setTimeout(r, 3000));
  await snap(ci, 'afterclick');

  await ci.exit();
  console.log('Done.');
}

main().catch((e) => {
  console.error('Probe error:', e);
  process.exit(1);
});
