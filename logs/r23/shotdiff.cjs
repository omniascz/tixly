// Kolo 23 — porovná snímky RED a GREEN (stejné rozměry, počet odlišných pixelů a jejich ohraničení). Použití: node shotdiff.cjs a.png b.png
const { PNG } = require('../../nextjs-boilerplate/node_modules/pngjs');
const fs = require('node:fs');
const [a, b] = process.argv.slice(2).map((f) => PNG.sync.read(fs.readFileSync(f)));
if (a.width !== b.width || a.height !== b.height) { console.log(`rozměry se liší: ${a.width}×${a.height} vs ${b.width}×${b.height}`); process.exit(0); }
let n = 0; let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
for (let y = 0; y < a.height; y++) for (let x = 0; x < a.width; x++) {
  const i = (y * a.width + x) * 4;
  if (a.data[i] !== b.data[i] || a.data[i + 1] !== b.data[i + 1] || a.data[i + 2] !== b.data[i + 2]) { n++; x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
}
console.log(`${a.width}×${a.height}; odlišných pixelů: ${n}${n ? ` v oblasti x ${x0}–${x1}, y ${y0}–${y1}` : ''}`);
