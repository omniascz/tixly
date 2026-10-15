// Kolo 19 — přesné pixelové porovnání (bez tolerance) jako e2e/r15-compare.mjs + max. rozdíl kanálu.
//   node compare.mjs <A> <B> [<diff adresář>]
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
const { PNG } = createRequire(import.meta.url)('../../nextjs-boilerplate/node_modules/pngjs');
const [a, b, out] = process.argv.slice(2);
if (out) mkdirSync(out, { recursive: true });
let same = 0; let diff = 0;
for (const f of readdirSync(a).filter((x) => x.endsWith('.png')).sort()) {
  if (!existsSync(join(b, f))) { console.log(`${f}: CHYBÍ v ${b}`); diff++; continue; }
  const A = PNG.sync.read(readFileSync(join(a, f))); const B = PNG.sync.read(readFileSync(join(b, f)));
  if (A.width !== B.width || A.height !== B.height) { console.log(`${f}: rozměr ${A.width}×${A.height} ≠ ${B.width}×${B.height}`); diff++; continue; }
  let n = 0; let mx = 0; let x0 = Infinity; let y0 = Infinity; let x1 = -1; let y1 = -1;
  const D = new PNG({ width: A.width, height: A.height });
  for (let y = 0; y < A.height; y++) for (let x = 0; x < A.width; x++) {
    const i = (y * A.width + x) * 4;
    const m = Math.max(Math.abs(A.data[i] - B.data[i]), Math.abs(A.data[i + 1] - B.data[i + 1]), Math.abs(A.data[i + 2] - B.data[i + 2]), Math.abs(A.data[i + 3] - B.data[i + 3]));
    if (m) { n++; if (m > mx) mx = m; if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
    const g = Math.round((A.data[i] + A.data[i + 1] + A.data[i + 2]) / 3 * 0.3 + 178);
    D.data[i] = m ? 255 : g; D.data[i + 1] = m ? 0 : g; D.data[i + 2] = m ? 0 : g; D.data[i + 3] = 255;
  }
  if (!n) { same++; console.log(`${f}: SHODA`); continue; }
  diff++;
  console.log(`${f}: rozdíl ${n} px (${(100 * n / (A.width * A.height)).toFixed(4)} %), max. rozdíl kanálu ${mx}/255, oblast (${x0}, ${y0}, ${x1}, ${y1}) z ${A.width}×${A.height}`);
  if (out) writeFileSync(join(out, f), PNG.sync.write(D));
}
console.log(`\nshodných ${same}/${same + diff}`);
