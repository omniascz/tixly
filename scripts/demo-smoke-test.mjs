// =============================================================================
// Tixly demo smoke test — ověří, že auth, middleware a tvorba akce navazují.
// Spuštění: node scripts/demo-smoke-test.mjs   (dev server musí běžet na :3000)
// =============================================================================

const BASE = 'http://localhost:3000';
const PASSWORD = 'Demo2026!';

let pass = 0;
let fail = 0;
const results = [];

function ok(name) {
  pass++;
  results.push(`  ✓ ${name}`);
}
function ko(name, msg) {
  fail++;
  results.push(`  ✗ ${name}\n      ${msg}`);
}

async function login(email) {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  if (!r.ok) throw new Error(`login ${email} → ${r.status}`);
  return r.json();
}

async function fetchAuth(path, opts = {}, token) {
  return fetch(`${BASE}${path}`, {
    ...opts,
    redirect: 'manual',
    headers: {
      ...(opts.headers ?? {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
}

console.log('\n=== TIXLY DEMO SMOKE TEST ===\n');

// ─── Test 1: 3× login ───────────────────────────────────────────────────────
console.log('1. Login pro 3 demo účty');
let admin, promoter, pendingPromoter;
try {
  admin = await login('superadmin@tixly.cz');
  if (admin.roles?.isPlatformAdmin === true) ok('superadmin: isPlatformAdmin = true');
  else ko('superadmin role', JSON.stringify(admin.roles));
} catch (e) {
  ko('superadmin login', e.message);
}
try {
  promoter = await login('admin@tixly.cz');
  const m = promoter.roles?.promoterMemberships?.[0];
  if (m?.status === 'active') ok('admin@tixly.cz: aktivní promotér membership');
  else ko('admin@tixly.cz', JSON.stringify(promoter.roles));
} catch (e) {
  ko('admin@tixly.cz login', e.message);
}
try {
  pendingPromoter = await login('pending@example.cz');
  const m = pendingPromoter.roles?.promoterMemberships?.[0];
  if (m?.status === 'pending') ok('pending@example.cz: pending status');
  else ko('pending@example.cz', JSON.stringify(pendingPromoter.roles));
} catch (e) {
  ko('pending@example.cz login', e.message);
}

// ─── Test 2: invalid credentials → 401 ─────────────────────────────────────
console.log('\n2. Bad credentials → 401');
{
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@tixly.cz', password: 'wrong' }),
  });
  if (r.status === 401) ok('špatné heslo → 401');
  else ko('bad password', `expected 401, got ${r.status}`);
}

// ─── Test 3: middleware gates ───────────────────────────────────────────────
console.log('\n3. Middleware role gates');
{
  // Anonymní /api/admin/events → 401
  const r = await fetch(`${BASE}/api/admin/events`);
  if (r.status === 401) ok('anon /api/admin/events → 401');
  else ko('anon admin', `expected 401, got ${r.status}`);
}
{
  // Anonymní /api/platform/* → 401
  const r = await fetch(`${BASE}/api/platform/anything`);
  if (r.status === 401) ok('anon /api/platform/* → 401');
  else ko('anon platform', `expected 401, got ${r.status}`);
}
if (promoter) {
  const r = await fetchAuth('/api/admin/events', {}, promoter.accessToken);
  if (r.ok) ok('promotér s tokenem /api/admin/events → 200');
  else ko('promoter admin events', `got ${r.status}`);
}
if (admin) {
  const r = await fetchAuth('/api/admin/events', {}, admin.accessToken);
  // Platform admin nemá promotér membership; existing requirePromoter vrátí 403
  if (r.status === 403) ok('platform admin /api/admin/events → 403 (správně, není promotér)');
  else if (r.ok) ok('platform admin /api/admin/events → 200 (přístupné)');
  else ko('admin admin events', `got ${r.status}`);
}
if (promoter) {
  const r = await fetchAuth('/api/platform/anything', {}, promoter.accessToken);
  if (r.status === 403) ok('promotér /api/platform/* → 403');
  else ko('promoter platform', `expected 403, got ${r.status}`);
}

// ─── Test 4: pending promotér nemůže vytvořit akci ──────────────────────────
console.log('\n4. Pending promotér nemůže vytvořit akci');
if (pendingPromoter) {
  const r = await fetchAuth(
    '/api/admin/events',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Test akce pending',
        dateStart: new Date(Date.now() + 86400000 * 30).toISOString(),
        ticketTypes: [{ name: 'Standard', priceHalire: 50000, capacity: 100 }],
      }),
    },
    pendingPromoter.accessToken,
  );
  if (r.status === 403) ok('pending promotér → 403 (čeká na schválení)');
  else ko('pending promoter create', `expected 403, got ${r.status}`);
}

// ─── Test 5: aktivní promotér vytvoří akci → pending_review nebo published ──
//   Po zavedení AI gate (vrstva 2, #217) může trusted promotér (≥5 schválených
//   akcí v posledních 90d) získat auto-publish. Test akceptuje obě cesty.
console.log('\n5. Aktivní promotér vytvoří akci');
let createdEventId;
if (promoter) {
  const r = await fetchAuth(
    '/api/admin/events',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Demo Smoke Test Concert ' + Date.now(),
        description: 'Bezpečný popis bez zakázaných slov.',
        dateStart: new Date(Date.now() + 86400000 * 30).toISOString(),
        ticketTypes: [
          { name: 'Standard', priceHalire: 50000, capacity: 100 },
          { name: 'VIP', priceHalire: 150000, capacity: 20 },
        ],
      }),
    },
    promoter.accessToken,
  );
  const data = await r.json();
  if (r.status === 201 && (data.status === 'pending_review' || data.status === 'published')) {
    ok(`akce vytvořena (status=${data.status})`);
    createdEventId = data.eventId;
  } else {
    ko('create event', `${r.status} → ${JSON.stringify(data)}`);
  }
}

// ─── Test 6: keyword auto-reject ─────────────────────────────────────────────
console.log('\n6. Auto-reject podle blocklistu');
if (promoter) {
  const r = await fetchAuth(
    '/api/admin/events',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Heil koncert',
        dateStart: new Date(Date.now() + 86400000 * 30).toISOString(),
        ticketTypes: [{ name: 'Standard', priceHalire: 50000, capacity: 100 }],
      }),
    },
    promoter.accessToken,
  );
  const data = await r.json();
  if (r.status === 201 && data.status === 'rejected') {
    ok('"Heil koncert" → status rejected');
  } else {
    ko('auto-reject', `${r.status} → ${JSON.stringify(data)}`);
  }
}

// ─── Test 7: veřejný /cs/events neukáže rejected ───────────────────────────
console.log('\n7. Veřejný seznam skrývá rejected akce');
{
  const r = await fetch(`${BASE}/cs/events`);
  if (r.status === 200) {
    const html = await r.text();
    if (html.includes('Heil koncert')) {
      ko('public events list', 'rejected akce viditelná veřejně!');
    } else {
      ok('/cs/events: rejected akce ukryté');
    }
  } else {
    ko('/cs/events fetch', `got ${r.status}`);
  }
}

// ─── Výsledky ────────────────────────────────────────────────────────────────
console.log('\n=== VÝSLEDKY ===');
results.forEach((r) => console.log(r));
console.log(`\nPass: ${pass}   Fail: ${fail}\n`);
process.exit(fail > 0 ? 1 : 0);
