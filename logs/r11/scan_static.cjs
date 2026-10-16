// Kolo 11: prototyp — GET handlery se síťovým přístupem, bez `dynamic`/`revalidate`, které nepoužívají request.
const fs = require('fs');
const path = require('path');
const out = [];
const NET = /@\/lib\/db|from 'pg'|import\('pg'\)|from 'redis'|import\('redis'\)|@\/lib\/queue|@\/lib\/email|@\/lib\/payment|fetch\(/;
function walk(d) {
  for (const n of fs.readdirSync(d)) {
    const p = path.join(d, n);
    if (fs.statSync(p).isDirectory()) walk(p);
    else if (/^route\.tsx?$/.test(n)) check(p);
  }
}
function check(p) {
  const s = fs.readFileSync(p, 'utf8');
  if (/^export\s+const\s+(dynamic|revalidate)\s*=/m.test(s)) return;
  if (!NET.test(s)) return;
  const m = /export\s+(?:async\s+)?function\s+GET\s*\(\s*(\w*)/.exec(s);
  if (!m) return;
  const name = m[1];
  const body = s.slice(m.index);
  const uses = name ? (body.match(new RegExp('\\b' + name + '\\b', 'g')) || []).length - 1 : 0;
  if (uses === 0) out.push(path.relative('src/app', p).split(path.sep).join('/') + (name ? ` (param ${name} nepoužit)` : ''));
}
walk('src/app');
console.log(out.join('\n') || '(nic)');
console.log('count', out.length);
