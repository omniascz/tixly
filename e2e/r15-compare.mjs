/**
 * Kolo 15 — pixelové porovnání dvou sad screenshotů (stejné názvy souborů).
 *   node r15-compare.mjs <adresář A> <adresář B> [<adresář pro diff obrázky>]
 * Výstup na stdout: „soubor: SHODA" nebo „soubor: rozdíl N px (x %), oblast (x0, y0, x1, y1)" / „rozměr A ≠ B".
 * Porovnání je přesné (žádná tolerance); rozdílné pixely jsou v diff obrázku červeně, zbytek ztlumený.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
const { PNG } = createRequire(import.meta.url)('../nextjs-boilerplate/node_modules/pngjs'); // pngjs je v aplikaci

const [a, b, out] = process.argv.slice(2);
if (out) mkdirSync(out, { recursive: true });
let same = 0; let diff = 0;
for (const f of readdirSync(a).filter((x) => x.endsWith('.png')).sort()) {
  if (!existsSync(join(b, f))) { console.log(`${f}: CHYBÍ v ${b}`); diff++; continue; }
  const A = PNG.sync.read(readFileSync(join(a, f)));
  const B = PNG.sync.read(readFileSync(join(b, f)));
  if (A.width !== B.width || A.height !== B.height) {
    console.log(`${f}: rozměr ${A.width}×${A.height} ≠ ${B.width}×${B.height}`); diff++; continue;
  }
  let n = 0; let x0 = Infinity; let y0 = Infinity; let x1 = -1; let y1 = -1;
  const D = new PNG({ width: A.width, height: A.height });
  for (let y = 0; y < A.height; y++) {
    for (let x = 0; x < A.width; x++) {
      const i = (y * A.width + x) * 4;
      const d = A.data[i] !== B.data[i] || A.data[i + 1] !== B.data[i + 1] || A.data[i + 2] !== B.data[i + 2] || A.data[i + 3] !== B.data[i + 3];
      if (d) { n++; if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
      const g = Math.round((A.data[i] + A.data[i + 1] + A.data[i + 2]) / 3 * 0.3 + 178);
      D.data[i] = d ? 255 : g; D.data[i + 1] = d ? 0 : g; D.data[i + 2] = d ? 0 : g; D.data[i + 3] = 255;
    }
  }
  if (n === 0) { console.log(`${f}: SHODA`); same++; continue; }
  diff++;
  console.log(`${f}: rozdíl ${n} px (${(100 * n / (A.width * A.height)).toFixed(3)} %), oblast (${x0}, ${y0}, ${x1}, ${y1})`);
  if (out) writeFileSync(join(out, f), PNG.sync.write(D));
}
for (const f of readdirSync(b).filter((x) => x.endsWith('.png') && !existsSync(join(a, x)))) { console.log(`${f}: CHYBÍ v ${a}`); diff++; }
console.log(`# shodných ${same}, rozdílných ${diff}`);
