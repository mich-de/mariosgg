const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
require(path.join(ROOT, 'node_modules/emulators/dist/emulators.js'));
globalThis.emulators.pathPrefix = path.join(ROOT, 'node_modules/emulators/dist') + '/';
globalThis.ImageData = class ImageData {
  constructor(data, width, height) { this.data = data; this.width = width; this.height = height; }
};

function getFilesRecursive(dir, base) {
  let res = [];
  for (const item of fs.readdirSync(dir)) {
    const full = path.join(dir, item);
    const rel = base ? base + '/' + item : item;
    if (fs.statSync(full).isDirectory()) res = res.concat(getFilesRecursive(full, rel));
    else res.push({ path: rel, contents: new Uint8Array(fs.readFileSync(full)) });
  }
  return res;
}

async function snap(ci, outDir, label) {
  const width = ci.width(), height = ci.height();
  const rgba = await ci.screenshot();
  const data = rgba.data || rgba;
  const header = `P6\n${width} ${height}\n255\n`;
  const rgbBuf = Buffer.alloc(width * height * 3);
  for (let i = 0; i < width * height; i++) {
    rgbBuf[i * 3 + 0] = data[i * 4 + 0];
    rgbBuf[i * 3 + 1] = data[i * 4 + 1];
    rgbBuf[i * 3 + 2] = data[i * 4 + 2];
  }
  const out = path.join(outDir, `${label}.ppm`);
  fs.writeFileSync(out, Buffer.concat([Buffer.from(header), rgbBuf]));
  console.log('saved', out, `${width}x${height}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const outDir = path.join(ROOT, 'asset_capture');
  fs.mkdirSync(outDir, { recursive: true });

  const gameFiles = getFilesRecursive(path.join(ROOT, '_source/mariosgg'), 'mariosgg');
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
  ci.events().onStdout(() => {});

  console.log('booting...');
  await sleep(26000);
  await snap(ci, outDir, '00_menu');

  console.log('selecting Checkers (C, then Enter)...');
  ci.simulateKeyPress(67); // C
  await sleep(700);
  ci.simulateKeyPress(257); // Enter
  await sleep(4000);
  await snap(ci, outDir, '01_title');
  await sleep(3000);
  await snap(ci, outDir, '02_title_settled');

  // Keep waiting / pressing Enter to skip through any intro dialogs to the board.
  for (let i = 0; i < 6; i++) {
    await sleep(2000);
    await snap(ci, outDir, `03_wait_${i}`);
  }

  console.log('answering Yoshi/Koopa prompt with Enter (default)...');
  ci.simulateKeyPress(257);
  await sleep(2500);
  await snap(ci, outDir, '04_after_enter1');
  ci.simulateKeyPress(257);
  await sleep(2500);
  await snap(ci, outDir, '05_after_enter2');
  ci.simulateKeyPress(257);
  await sleep(3000);
  await snap(ci, outDir, '06_after_enter3');
  await sleep(4000);
  await snap(ci, outDir, '07_settled');

  console.log('trying Y key for YOSHIS...');
  ci.simulateKeyPress(89); // Y
  await sleep(3000);
  await snap(ci, outDir, '08_after_Y');
  await sleep(4000);
  await snap(ci, outDir, '09_settled2');

  console.log('accepting default name with Enter...');
  ci.simulateKeyPress(257);
  await sleep(3000);
  await snap(ci, outDir, '10_after_name_enter');
  await sleep(4000);
  await snap(ci, outDir, '11_settled3');
  await sleep(4000);
  await snap(ci, outDir, '12_settled4');

  await ci.exit();
  console.log('done.');
}

main().catch((e) => { console.error(e); process.exit(1); });
