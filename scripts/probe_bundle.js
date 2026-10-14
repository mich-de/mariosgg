const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
require(path.join(ROOT, 'node_modules/emulators/dist/emulators.js'));
globalThis.emulators.pathPrefix = path.join(ROOT, 'node_modules/emulators/dist') + '/';
globalThis.ImageData = class ImageData {
  constructor(data, width, height) {
    this.data = data;
    this.width = width;
    this.height = height;
  }
};

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
    const out = path.join(ROOT, 'screenshots', `bundle_${label}.ppm`);
    fs.writeFileSync(out, Buffer.concat([Buffer.from(header), rgbBuf]));
    console.log('Saved', out, `${width}x${height}`);
  }
}

async function main() {
  const bundleBuffer = new Uint8Array(fs.readFileSync(path.join(ROOT, 'mariosgg.jsdos')));
  const ci = await globalThis.emulators.dosboxNode(bundleBuffer);
  ci.events().onStdout((msg) => process.stdout.write('[DOS] ' + msg));

  await new Promise((r) => setTimeout(r, 26000));
  await snap(ci, 'menu');

  await ci.exit();
  console.log('Done.');
}

main().catch((e) => {
  console.error('Bundle probe error:', e);
  process.exit(1);
});
