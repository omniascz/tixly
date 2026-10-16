// Kolo 23 — rozbor snímků P (RED 398×136 vs GREEN 398×132): po řádcích porovná RED a GREEN a hledá posun.
// Použití: node shotcmp_p.cjs red.png green.png
const { PNG } = require('../../nextjs-boilerplate/node_modules/pngjs');
const fs = require('node:fs');
const [a, b] = process.argv.slice(2).map((f) => PNG.sync.read(fs.readFileSync(f)));
const px = (img, x, y) => { const i = (y * img.width + x) * 4; return (img.data[i] << 16) | (img.data[i + 1] << 8) | img.data[i + 2]; };
const rowDiff = (ya, yb, x0, x1) => { let n = 0; for (let x = x0; x < x1; x++) if (px(a, x, ya) !== px(b, x, yb)) n++; return n; };
// Wero dlaždice v RED: sloupce, kde se v horní řadě RED liší od GREEN (x ≥ 260)
console.log(`RED ${a.width}×${a.height}, GREEN ${b.width}×${b.height}, rozdíl výšky ${a.height - b.height} px`);
for (const [label, x0, x1] of [['celá šířka', 0, a.width], ['Karta + Převodem (x 0–264)', 0, 265], ['sloupec Wero (x 265–397)', 265, a.width]]) {
  let same = 0; const diffRows = [];
  for (let y = 0; y < b.height; y++) { const d = rowDiff(y, y, x0, x1); if (d === 0) same++; else diffRows.push(y); }
  console.log(`${label}: řádků shodných bez posunu ${same}/${b.height}; odlišné řádky y ${diffRows.length ? `${diffRows[0]}–${diffRows[diffRows.length - 1]} (${diffRows.length})` : '—'}`);
}
// spodní část (Firemní kredit) posunutá o rozdíl výšky
const dy = a.height - b.height; let sameShift = 0, from = -1;
for (let y = b.height - 1; y >= 0; y--) { if (rowDiff(y + dy, y, 0, a.width) === 0) { sameShift++; from = y; } else break; }
console.log(`spodek GREEN y ${from}–${b.height - 1} = RED y ${from + dy}–${a.height - 1} (posun ${dy} px): ${sameShift} řádků pixelově shodných`);
// řádek po řádku v oblasti Karta + Převodem: který posun (0–4 px) dává shodu
const map = [];
for (let y = 0; y < b.height; y++) { let hit = null; for (const s of [0, 1, 2, 3, 4]) { if (y + s < a.height && rowDiff(y + s, y, 0, 265) === 0) { hit = s; break; } } map.push(hit); }
const runs = []; for (let y = 0; y < map.length; y++) { const last = runs[runs.length - 1]; if (last && last.s === map[y]) last.to = y; else runs.push({ s: map[y], from: y, to: y }); }
console.log('Karta + Převodem (x 0–264), GREEN řádky → posun vůči RED: ' + runs.map((r) => `y ${r.from}–${r.to}: ${r.s === null ? 'bez shody' : `+${r.s} px`}`).join('; '));
