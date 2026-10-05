// Kolo 10 / krok 3: vloží `launchFeatureNotFound(feature)` jako první příkaz zadaných handlerů.
// node gate_routes.cjs <soubor> <feature> <METODA...>
const fs = require('fs');
const [, , file, feature, ...methods] = process.argv;
let s = fs.readFileSync(file, 'utf8');
const eol = s.includes('\r\n') ? '\r\n' : '\n';
if (s.includes('launchFeatureNotFound(')) throw new Error('už obsahuje bránu: ' + file);
if (!s.includes("from '@/lib/features/launch-flags'")) {
  const lines = s.split(eol);
  // za poslední řádek bloku importů na začátku souboru (víceřádkový import končí řádkem s `;`)
  let last = -1, inImport = false;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^import /.test(l)) { inImport = !/;\s*$/.test(l); last = i; continue; }
    if (inImport) { if (/;\s*$/.test(l)) { inImport = false; last = i; } continue; }
    if (last >= 0 && l.trim() !== '' && !l.startsWith('//')) break;
  }
  if (last < 0) throw new Error('bez importů: ' + file);
  lines.splice(last + 1, 0, "import { launchFeatureNotFound } from '@/lib/features/launch-flags';");
  s = lines.join(eol);
}
for (const m of methods) {
  const at = s.search(new RegExp('export async function ' + m + '\\s*\\('));
  if (at < 0) throw new Error(m + ' nenalezen v ' + file);
  const re = /\)\s*(?::\s*[^{;]*?)?\s*\{\r?\n/g;
  re.lastIndex = at;
  const mm = re.exec(s);
  if (!mm) throw new Error('konec signatury nenalezen ' + m);
  const ins = mm.index + mm[0].length;
  const block = '  // Kolo 10: vypnuto přepínačem (výchozí stav) → 404.' + eol
    + "  const featureOff = launchFeatureNotFound('" + feature + "');" + eol
    + '  if (featureOff) return featureOff;' + eol;
  s = s.slice(0, ins) + block + s.slice(ins);
}
fs.writeFileSync(file, s);
console.log('OK', file, methods.join(','));
