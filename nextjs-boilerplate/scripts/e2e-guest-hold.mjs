/**
 * E2E: guest seat-hold úklid + izolace (oprava P2 z auditu 2026-06-11).
 *
 * Ověřuje:
 *  1) Guest s fingerprintem FP1 drží A,B → drží C,D → A,B se UVOLNÍ (release MY prior).
 *  2) Retry: FP1 drží A,B, pak znovu A,B → PROJDE (ne SEAT_UNAVAILABLE na vlastní hold).
 *  3) Izolace: FP2 drží E,F; FP1 na E,F → SEAT_UNAVAILABLE, FP2 hold PŘEŽIJE.
 *  4) Bez fingerprintu: dva no-fp guesti se NEUVOLŇUJÍ (žádný sdílený-tag wipe).
 *
 * Pozn.: čistí po sobě (uvolní použitá sedadla zpět na available).
 */
const BASE = 'http://localhost:3000';
const EVENT = '00000000-0000-4000-a000-000000000402';
const [A, B, C, D, E, F] = [
  '01513560-1df0-4312-a160-2e58ab11171c',
  '01a7d4d6-0a39-4bf8-bfbc-b24894e9a498',
  '01bf7bf9-5695-4338-b509-8309ed9f4b7b',
  '01e25652-e81a-4e6b-bcbe-2b6cf0961164',
  '02aa6905-be3e-4dd7-8f82-2c7d16c334d9',
  '0332de28-e6a6-425e-9dc3-5df6f9cc7cbb',
];

async function hold(seatIds, fingerprint) {
  const headers = { 'Content-Type': 'application/json' };
  if (fingerprint) headers['x-fingerprint'] = fingerprint;
  const res = await fetch(`${BASE}/api/events/${EVENT}/seats/hold`, {
    method: 'POST', headers, body: JSON.stringify({ seatIds }),
  });
  let json = null; try { json = await res.json(); } catch { /* */ }
  return { status: res.status, json };
}
async function del(holdToken) {
  await fetch(`${BASE}/api/events/${EVENT}/seats/hold`, {
    method: 'DELETE', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ holdToken }),
  });
}

const results = [];
function check(label, cond, detail = '') {
  results.push(!!cond);
  console.log(`${cond ? '✅' : '❌'} ${label}${detail ? `  → ${detail}` : ''}`);
}

// 1) release MY prior
const h1 = await hold([A, B], 'FP1');
check('FP1 drží A,B (200)', h1.status === 200, `status=${h1.status}`);
const h2 = await hold([C, D], 'FP1');
check('FP1 drží C,D (200)', h2.status === 200, `status=${h2.status}`);
// A,B by teď měly být znovu available → třetí guest je zabere
const h3 = await hold([A, B], 'FP_OTHER');
check('A,B se uvolnily po přehození výběru (cizí guest je zabral)', h3.status === 200, `status=${h3.status}`);
if (h3.json?.holdToken) await del(h3.json.holdToken);

// 2) retry na vlastní hold
const r1 = await hold([A, B], 'FP_RETRY');
check('FP_RETRY drží A,B (200)', r1.status === 200, `status=${r1.status}`);
const r2 = await hold([A, B], 'FP_RETRY');
check('FP_RETRY znovu A,B = PROJDE (vlastní hold uvolněn)', r2.status === 200, `status=${r2.status} err=${r2.json?.error}`);
if (r2.json?.holdToken) await del(r2.json.holdToken);
if (h2.json?.holdToken) await del(h2.json.holdToken);

// 3) izolace
const i1 = await hold([E, F], 'FP2');
check('FP2 drží E,F (200)', i1.status === 200, `status=${i1.status}`);
const i2 = await hold([E, F], 'FP1');
check('FP1 NEUKRADNE E,F (409 SEAT_UNAVAILABLE)', i2.status === 409, `status=${i2.status} err=${i2.json?.error}`);
// FP2 hold přežil → FP2 retry projde (vlastní)
const i3 = await hold([E, F], 'FP2');
check('FP2 hold přežil cizí pokus (FP2 retry 200)', i3.status === 200, `status=${i3.status}`);
if (i3.json?.holdToken) await del(i3.json.holdToken);

// 4) bez fingerprintu se guesti neuvolňují
const n1 = await hold([C, D], undefined);
check('no-fp guest #1 drží C,D (200)', n1.status === 200, `status=${n1.status}`);
const n2 = await hold([A, B], undefined);
check('no-fp guest #2 drží A,B (200)', n2.status === 200, `status=${n2.status}`);
// guest #1 hold C,D musí přežít (guest #2 ho nesměl sdíleným tagem smáznout) → cizí na C,D = 409
const n3 = await hold([C, D], 'FP_PROBE');
check('no-fp hold #1 (C,D) NEBYL smazán guestem #2', n3.status === 409, `status=${n3.status} err=${n3.json?.error}`);
if (n1.json?.holdToken) await del(n1.json.holdToken);
if (n2.json?.holdToken) await del(n2.json.holdToken);
if (n3.json?.holdToken) await del(n3.json.holdToken);

const pass = results.filter(Boolean).length;
console.log(`\n═══ ${pass}/${results.length} kontrol PROŠLO ═══`);
process.exit(pass === results.length ? 0 : 1);
