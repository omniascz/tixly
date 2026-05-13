// =============================================================================
// Tixly demo: dynamický TOTP barcode E2E
// Spuštění:  node scripts/demo-totp-barcode.mjs   (dev server na :3000, db naplněná)
//
// Co testuje:
//   1. Buyer se přihlásí a vidí svoje lístky
//   2. /api/buyer/tickets/<id>/totp vrátí kód, expiresInSec, payload
//   3. Druhé volání ve stejném 30s okně vrací IDENTICKÝ kód (stabilní v okně)
//   4. Promotér akce zavolá /api/admin/scanner/validate s payloadem → admitted
//   5. Druhý sken stejného ticketu → already_used
//   6. ASCII vykreslení QR pro vizuální check (terminal output)
// =============================================================================

// QR kód si lze vykreslit v browseru (URL se vypíše níže) nebo přes:
//   node -e "import('qrcode').then(q=>q.default.toString(process.argv[1],{type:'terminal',small:true}).then(console.log))" 'tixly:<id>:<code>'

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const PASSWORD = 'Demo2026!';
const BUYER_CANDIDATES = [
  'petr.standard@example.cz',
  'anna.nova@example.cz',
  'fanda.fanousek@example.cz',
];

let pass = 0;
let fail = 0;
const results = [];

const ok = (n) => { pass++; results.push(`  ✓ ${n}`); };
const ko = (n, m) => { fail++; results.push(`  ✗ ${n}\n      ${m}`); };

async function login(email) {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  if (!r.ok) throw new Error(`login ${email} → ${r.status}`);
  return r.json();
}

async function authFetch(path, token, opts = {}) {
  return fetch(`${BASE}${path}`, {
    ...opts,
    headers: {
      ...(opts.headers ?? {}),
      Authorization: `Bearer ${token}`,
    },
  });
}

console.log('\n=== TIXLY DYNAMICKÝ BARCODE E2E ===\n');

// ─── Krok 1: najdi buyera s validním ticketem ──────────────────────────────
let buyer = null;
let validTicket = null;

for (const email of BUYER_CANDIDATES) {
  try {
    const session = await login(email);
    const r = await authFetch('/api/buyer/my-tickets', session.accessToken);
    if (!r.ok) continue;
    const data = await r.json();
    const v = data.tickets.find((t) => t.status === 'valid');
    if (v) {
      buyer = { email, session };
      validTicket = v;
      ok(`Buyer ${email} má valid ticket ${v.id.slice(0, 8)} pro "${v.event_title}"`);
      break;
    }
  } catch (e) {
    // try next
  }
}

if (!buyer) {
  ko('najít buyera s valid ticketem', 'žádný kandidát nemá valid lístek (zkontroluj seedy)');
  console.log('\n=== VÝSLEDKY ===');
  results.forEach((r) => console.log(r));
  console.log(`\nPass: ${pass}   Fail: ${fail}\n`);
  process.exit(1);
}

// ─── Krok 2: TOTP endpoint vrátí code + payload ─────────────────────────────
console.log('\n2. TOTP endpoint');
const totpRes1 = await authFetch(
  `/api/buyer/tickets/${validTicket.id}/totp`,
  buyer.session.accessToken,
);
if (totpRes1.status !== 200) {
  ko('GET /totp', `expected 200, got ${totpRes1.status}: ${await totpRes1.text()}`);
  console.log('\n=== VÝSLEDKY ===');
  results.forEach((r) => console.log(r));
  process.exit(1);
}
const totp1 = await totpRes1.json();
const codeOk = /^\d{6}$/.test(totp1.code);
const payloadOk = totp1.payload === `tixly:${validTicket.id}:${totp1.code}`;
const expOk = typeof totp1.expiresInSec === 'number' && totp1.expiresInSec > 0 && totp1.expiresInSec <= 30;
codeOk ? ok(`code je 6-digit: ${totp1.code}`) : ko('code formát', JSON.stringify(totp1));
payloadOk ? ok(`payload má tvar tixly:<id>:<code>`) : ko('payload', totp1.payload);
expOk ? ok(`expiresInSec v rozsahu (1..30): ${totp1.expiresInSec}s`) : ko('expiresInSec', String(totp1.expiresInSec));

// ─── Krok 3: druhé volání ve stejném okně = stejný kód ─────────────────────
console.log('\n3. Stabilita kódu v rámci 30s okna');
await new Promise((r) => setTimeout(r, 250));
const totpRes2 = await authFetch(
  `/api/buyer/tickets/${validTicket.id}/totp`,
  buyer.session.accessToken,
);
const totp2 = await totpRes2.json();
if (totp2.code === totp1.code) ok('druhé volání ve stejném okně → stejný kód');
else if (totp2.expiresInSec > totp1.expiresInSec) ok('mezi voláními se přepnulo okno → různý kód (correct)');
else ko('stabilita', `1: ${totp1.code} (zbývalo ${totp1.expiresInSec}s) vs 2: ${totp2.code}`);

// ─── Krok 4: vizuální check — vypsat URL pro browser ───────────────────────
console.log('\n4. Vizuální check — otevři v browseru:');
console.log(`   ${BASE}/cs/tickets/${validTicket.id}/show`);
console.log(`   (login: ${buyer.email} / ${PASSWORD})`);
console.log(`   Payload aktuálního QR: ${totp2.payload}\n`);

// ─── Krok 5: scanner endpoint přijme aktuální kód ──────────────────────────
console.log('5. Scanner validuje');

// Najdi promotéra který vlastní event tohoto ticketu
const PROMOTER_CANDIDATES = [
  'admin@tixly.cz',
  'theatre@hranice.cz',
  'koncerty@nationalgroup.cz',
  'arena@multiprod.cz',
  'klub@underground.cz',
];

let admittedFromOne = false;
let alreadyUsedFromSecondScan = false;
let promoterUsed = null;

for (const pemail of PROMOTER_CANDIDATES) {
  try {
    const psession = await login(pemail);
    const r = await authFetch(
      '/api/admin/scanner/validate',
      psession.accessToken,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticketId: validTicket.id, totpCode: totp2.code }),
      },
    );
    const data = await r.json();
    if (data.result === 'admitted') {
      ok(`promotér ${pemail} → admitted`);
      admittedFromOne = true;
      promoterUsed = psession;
      break;
    } else if (data.result === 'already_used') {
      ok(`ticket už dříve admitted, scanner vrací already_used (idempotent)`);
      admittedFromOne = true;
      alreadyUsedFromSecondScan = true;
      promoterUsed = psession;
      break;
    } else if (data.result === 'wrong_promoter') {
      // try next
      continue;
    } else {
      // some other failure — note ale pokračuj
      console.log(`     promoter ${pemail}: ${data.result} ${data.message ?? ''}`);
    }
  } catch (e) {
    // skip
  }
}
if (!admittedFromOne) ko('admit ticket', 'žádný z testovacích promotérů ticket nepřijal');

// ─── Krok 6: druhý sken → already_used (idempotence) ───────────────────────
if (admittedFromOne && promoterUsed && !alreadyUsedFromSecondScan) {
  console.log('\n6. Druhý sken stejného ticketu');
  const r = await authFetch(
    '/api/admin/scanner/validate',
    promoterUsed.accessToken,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticketId: validTicket.id, totpCode: totp2.code }),
    },
  );
  const data = await r.json();
  if (data.result === 'already_used') ok('druhý sken → already_used (idempotent)');
  else ko('druhý sken', `expected already_used, got ${data.result}`);
}

// ─── Krok 7: špatný TOTP kód → totp_mismatch ───────────────────────────────
console.log('\n7. Špatný TOTP kód');
if (promoterUsed) {
  // Najdi jiný valid ticket (anebo stejný — pokud už used, vrátí already_used PŘED kontrolou TOTP — tak musíme použít fresh ticket)
  // Pro jednoduchost zkusíme jiný ticket; když není, skip.
  const r = await authFetch('/api/buyer/my-tickets', buyer.session.accessToken);
  const data = await r.json();
  const other = data.tickets.find((t) => t.status === 'valid' && t.id !== validTicket.id);
  if (!other) {
    console.log('     skip — žádný další valid ticket pro test');
  } else {
    const r2 = await authFetch(
      '/api/admin/scanner/validate',
      promoterUsed.accessToken,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticketId: other.id, totpCode: '000000' }),
      },
    );
    const d2 = await r2.json();
    if (d2.result === 'totp_mismatch') ok('špatný kód → totp_mismatch');
    else if (d2.result === 'wrong_promoter') console.log('     skip — jiný promotér vlastní druhý ticket');
    else ko('totp mismatch', `expected totp_mismatch, got ${d2.result}`);
  }
}

console.log('\n=== VÝSLEDKY ===');
results.forEach((r) => console.log(r));
console.log(`\nPass: ${pass}   Fail: ${fail}\n`);
process.exit(fail > 0 ? 1 : 0);
