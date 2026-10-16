// Kolo 19 — typy položek a událostí v souborech simulátoru Sentry + grep testovacích osobních údajů.
//   node envelope_types.mjs <soubor.jsonl> [<soubor.raw.jsonl>]
import { existsSync, readFileSync } from 'node:fs';
const [f, rawF] = process.argv.slice(2);
const items = readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
const kinds = {};
for (const i of items) {
  const t = i.item_type ?? i.raw.type ?? 'event';
  const what = t === 'event' ? `event: ${(i.raw.exception?.values?.[0]?.value ?? i.raw.message ?? '').replace(/:.*$/, '').slice(0, 40)}`
    : t === 'transaction' ? 'transaction' : `span (${(i.raw.items ?? []).length})`;
  const k = t === 'span' ? 'span' : what;
  kinds[k] = (kinds[k] ?? 0) + (t === 'span' ? (i.raw.items ?? []).length : 1);
}
console.log(JSON.stringify(kinds));
if (rawF && existsSync(rawF)) {
  const raw = readFileSync(rawF, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l).body).join('\n');
  for (const [l, re] of [['jana@x.cz', /jana(?:@|%40|\u0040)x\.cz/gi], ['777 123 456', /777[\s+%20-]*123[\s+%20-]*456/g], ['Nováková', /Nov(?:á|\u00e1|%C3%A1)kov/gi], ['10.255.255.1', /10\.255\.255\.1\b/g], ['ip_address', /"(?:user\.)?ip_address"|"client\.address"/g], ['{{auto}}', /\{\{auto\}\}/g]]) {
    console.log(`grep ${l}: ${(raw.match(re) ?? []).length}`);
  }
}
