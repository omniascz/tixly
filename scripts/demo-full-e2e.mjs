// =============================================================================
// Full E2E demo flow:
//  1) admin@tixly.cz vytvoří akci → pending_review
//  2) superadmin schválí akci → published
//  3) /cs/events ukáže akci
//  4) Kupec zavolá /api/checkout-demo → order pending + payment
//  5) /api/mock-gopay/[id] s action=pay → order paid + webhook
//  6) /api/internal/order-completed → email do Mailhogu
//  7) Mailhog API ukáže email
// =============================================================================

const BASE = 'http://localhost:3000';
const MAILHOG = 'http://localhost:8025/api/v2';

let pass = 0, fail = 0;
const results = [];
const ok = (n) => { pass++; results.push(`  ✓ ${n}`); };
const ko = (n, msg) => { fail++; results.push(`  ✗ ${n}\n      ${msg}`); };

async function login(email) {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'Demo2026!' }),
  });
  if (!r.ok) throw new Error(`login ${email} → ${r.status}`);
  return r.json();
}

console.log('\n=== TIXLY FULL E2E DEMO ===\n');

// Clean Mailhog
await fetch(`${MAILHOG}/messages`, { method: 'DELETE' }).catch(() => {});

// Logins
const promoter = await login('admin@tixly.cz');
const admin = await login('superadmin@tixly.cz');
ok('login: admin@tixly.cz + superadmin@tixly.cz');

// Step 1: Vytvoř akci jako promotér
const titleSuffix = Math.floor(Math.random() * 1e6);
const eventTitle = `E2E Test Concert ${titleSuffix}`;
const createRes = await fetch(`${BASE}/api/admin/events`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${promoter.accessToken}`,
  },
  body: JSON.stringify({
    title: eventTitle,
    description: 'E2E test, bez problémů.',
    dateStart: new Date(Date.now() + 30 * 86400000).toISOString(),
    ticketTypes: [{ name: 'Standard', priceHalire: 30000, capacity: 50 }],
  }),
});
const created = await createRes.json();
if (createRes.status === 201 && created.status === 'pending_review') {
  ok(`1. promotér vytvořil akci → pending_review (id=${created.eventId.slice(0, 8)})`);
} else {
  ko('1. create event', `${createRes.status} → ${JSON.stringify(created)}`);
  process.exit(1);
}
const eventId = created.eventId;

// Step 2: superadmin schválí
const approveRes = await fetch(`${BASE}/api/platform/moderation/${eventId}/approve`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${admin.accessToken}` },
});
if (approveRes.ok) ok('2. superadmin schválil akci → published');
else ko('2. approve', `${approveRes.status} → ${await approveRes.text()}`);

// Step 3: /cs/events ukáže akci
const eventsHtml = await (await fetch(`${BASE}/cs/events`)).text();
if (eventsHtml.includes(eventTitle)) ok('3. /cs/events: schválená akce viditelná');
else ko('3. public events', 'akce není v HTML');

// Najdi ticketTypeId přes detail page
const detailHtml = await (await fetch(`${BASE}/cs/events/${eventId}`)).text();
// Detail page má form data attributes, ale je server-rendered. Jednodušší: SQL ne, čteme z DB jiným způsobem.
// Pro test použijeme přímý dotaz přes psql.
import { execSync } from 'node:child_process';
const ticketTypeId = execSync(
  `docker compose exec -T postgres psql -U tixly -d tixly -tA -c "SELECT id FROM catalog.ticket_types WHERE event_id = '${eventId}' LIMIT 1"`,
  { encoding: 'utf8' },
)
  .trim()
  .split('\n')
  .pop();

if (!ticketTypeId || !ticketTypeId.includes('-')) {
  ko('ticket type lookup', ticketTypeId);
  process.exit(1);
}

// Step 4: Checkout
const checkoutRes = await fetch(`${BASE}/api/checkout`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    eventId,
    ticketTypeId,
    buyerEmail: `kupec-${titleSuffix}@example.cz`,
    buyerName: 'Demo Kupec',
    quantity: 2,
  }),
});
const checkout = await checkoutRes.json();
if (checkoutRes.ok && checkout.orderId && checkout.paymentId) {
  ok(`4. checkout: order ${checkout.orderId.slice(0, 8)} + payment ${checkout.paymentId}`);
} else {
  ko('4. checkout', `${checkoutRes.status} → ${JSON.stringify(checkout)}`);
  process.exit(1);
}

// Step 5: Mock GoPay → pay
const payRes = await fetch(`${BASE}/api/mock-gopay/${checkout.paymentId}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ action: 'pay' }),
});
const pay = await payRes.json();
if (payRes.ok && pay.status === 'paid') ok(`5. mock-gopay: order → paid`);
else ko('5. mock-gopay pay', `${payRes.status} → ${JSON.stringify(pay)}`);

// Step 6: Wait a bit for webhook to send email (fire-and-forget)
await new Promise((r) => setTimeout(r, 1500));

// Step 7: Mailhog má email (subject je QP-encoded, kontrolujeme To+body)
const mailRes = await fetch(`${MAILHOG}/messages`);
const mail = await mailRes.json();
const buyerEmail = `kupec-${titleSuffix}@example.cz`;
const ourEmail = mail.items?.find((m) => {
  const to = m.Content?.Headers?.To?.[0] ?? '';
  return to.includes(`kupec-${titleSuffix}`);
});
if (ourEmail) {
  ok(
    `6. Mailhog: confirmation email pro ${buyerEmail} (Tixly subject, ${ourEmail.Content?.Body?.length ?? 0}B body)`,
  );
} else {
  ko(
    '6. Mailhog email',
    `${mail.items?.length ?? 0} mailů, žádný pro ${buyerEmail}`,
  );
}

// Final: order detail page
const confirmHtml = await (await fetch(`${BASE}/cs/order-confirmation/${checkout.orderId}`)).text();
if (confirmHtml.includes('Objednávka zaplacena') && confirmHtml.includes(eventTitle)) {
  ok('7. /cs/order-confirmation/[id] zobrazí potvrzení');
} else {
  ko('7. confirmation page', 'HTML neobsahuje očekávaný text');
}

// Test rejection flow
const rejectEventRes = await fetch(`${BASE}/api/admin/events`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${promoter.accessToken}`,
  },
  body: JSON.stringify({
    title: `Investiční příležitost ${titleSuffix}`,
    dateStart: new Date(Date.now() + 30 * 86400000).toISOString(),
    ticketTypes: [{ name: 'Standard', priceHalire: 100, capacity: 10 }],
  }),
});
const rejectEvent = await rejectEventRes.json();
// Po zavedení AI gate (#217) je „Investiční příležitost" auto-rejected
// vrstvou 2 (mock provider). Stará logika čekala flag → queue → manual reject.
if (rejectEvent.status === 'rejected') {
  ok('8. AI gate auto-reject scam title');
} else if (rejectEvent.status === 'pending_review') {
  ok('8. flag_for_review keyword → akce v queue');
  // Master admin reject (jen pro pending_review)
  if (rejectEvent.eventId) {
    const rejRes = await fetch(`${BASE}/api/platform/moderation/${rejectEvent.eventId}/reject`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${admin.accessToken}`,
      },
      body: JSON.stringify({ reason: 'Vypadá jako scam' }),
    });
    if (rejRes.ok) ok('9. moderation reject s důvodem');
    else ko('9. moderation reject', `${rejRes.status}`);
  }
} else {
  ko('8. moderation outcome', JSON.stringify(rejectEvent));
}

// === Výsledky ===
console.log('\n=== VÝSLEDKY ===');
results.forEach((r) => console.log(r));
console.log(`\nPass: ${pass}   Fail: ${fail}\n`);
process.exit(fail > 0 ? 1 : 0);
