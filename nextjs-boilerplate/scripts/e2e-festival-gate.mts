/**
 * E2E — FESTIVAL GATE ENFORCEMENT (modular access + re-entry).
 *
 * ⚠️  PŘEDPOKLADY (tento skript je NESPUSTÍ za tebe):
 *   1. Běžící dev server:   npm run dev   (http://localhost:3000)
 *   2. Naseedovaná DB s master adminem superadmin@tixly.cz / Demo2026!
 *   3. .env.local s DATABASE_URL (RLS může být ENFORCED — DB dotazy běží v
 *      service/admin kontextu jako v ostatních e2e-*.mjs skriptech).
 *   Spuštění (až bude server + DB):  npx tsx scripts/e2e-festival-gate.mts
 *
 * Co ověřuje (vše proti scanner endpointům, plus DB cross-check):
 *   1. ADMIT na správný den + zónu
 *   2. REJECT špatný den            → result 'wrong_zone_or_day' (403)
 *   3. REJECT špatná zóna           → result 'wrong_zone_or_day' (403)
 *   4. Per-ticket modular access (tickets.ticket_modular_access) má přednost
 *      → admit na vybraný (day,zone), reject na nevybraný (403)
 *   5. Re-entry: entry → exit → re-entry (scan_count roste, remaining klesá)
 *   6. REJECT 2× entry za sebou     → result 'already_inside' (409)
 *   7. REJECT exit když venku        → result 'not_inside' (409)
 *   8. REJECT re-entry přes max       → result 'reentry_limit_exceeded' (409)
 *   9. REJECT re-entry na akci bez reentry_allowed → 'reentry_disabled' (422)
 *
 * Seeding zrcadlí scripts/e2e-full-suite.mjs (multi_day_festival template) a
 * scripts/e2e-group-admit.mjs (login/checkout/poll na vystavený lístek, DB
 * manipulace v service kontextu). Re-entry sloupce (events.reentry_allowed /
 * reentry_max_count) nemá žádný admin endpoint → nastavujeme je přímo v DB,
 * stejně jako e2e-group-admit přepisuje orders.user_id.
 */
import { readFileSync } from 'node:fs';
import pg from 'pg';

const BASE = 'http://localhost:3000';
const ts = Date.now();
const PW = 'Demo2026!';

const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
const dbUrl = (env.match(/^DATABASE_URL="?([^"\n]+)"?/m) || [])[1];
const pool = new pg.Pool({ connectionString: dbUrl, max: 4 });

// DB dotaz v service kontextu (jako e2e-full-suite / e2e-group-admit).
async function q<T extends pg.QueryResultRow = pg.QueryResultRow>(
  sql: string,
  params: unknown[] = [],
): Promise<pg.QueryResult<T>> {
  const c = await pool.connect();
  try {
    await c.query(`SET app.role = 'service'`);
    return await c.query<T>(sql, params);
  } finally {
    c.release();
  }
}

interface ApiResult {
  status: number;
  j: any;
}
async function api(
  method: string,
  path: string,
  { token, body }: { token?: string; body?: unknown } = {},
): Promise<ApiResult> {
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let j: any = null;
  try {
    j = await res.json();
  } catch {
    /* no body */
  }
  return { status: res.status, j };
}

async function login(email: string): Promise<any> {
  return (await api('POST', '/api/auth/login', { body: { email, password: PW } })).j;
}

const R: { l: string; ok: boolean }[] = [];
function check(l: string, cond: unknown, d = ''): boolean {
  const ok = !!cond;
  R.push({ l, ok });
  console.log(`  ${ok ? '✅' : '❌'} ${l}${d ? `  → ${d}` : ''}`);
  return ok;
}
function must(l: string, cond: unknown, d = ''): void {
  if (!check(l, cond, d)) throw new Error(`SETUP SELHAL: ${l} ${d}`);
}

// Koupit + zaplatit + počkat na vystavený lístek (mirror e2e-group-admit/full-suite).
async function buyAndPay(
  eventId: string,
  ticketTypeId: string,
  buyerEmail: string,
  qty = 1,
): Promise<{ ok: boolean; orderId?: string; ticketId?: string }> {
  const co = await api('POST', '/api/checkout', {
    body: { eventId, ticketTypeId, quantity: qty, buyerEmail, buyerName: 'Gate Buyer' },
  });
  if (co.status !== 200 || !co.j?.orderId) return { ok: false };
  if (co.j?.paymentId) await api('POST', `/api/mock-gopay/${co.j.paymentId}`, { body: { action: 'pay' } });
  let ticketId: string | null = null;
  for (let i = 0; i < 15; i++) {
    const t = await q<{ id: string }>(
      `SELECT id FROM tickets.tickets WHERE order_id = $1 AND status = 'valid' LIMIT 1`,
      [co.j.orderId],
    );
    if (t.rows[0]) {
      ticketId = t.rows[0].id;
      break;
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return { ok: !!ticketId, orderId: co.j.orderId, ticketId: ticketId ?? undefined };
}

async function main(): Promise<void> {
  console.log(`\n═══ E2E FESTIVAL GATE ENFORCEMENT (ts=${ts}) ═══`);

  // ════════ SETUP: master admin + promotér ════════
  console.log('\n━━━ SETUP: master admin + promotér + festival ━━━');
  const ma = await login('superadmin@tixly.cz');
  must('Master admin login', ma?.roles?.isPlatformAdmin);

  // Registrace + schválení promotéra (mirror e2e-group-admit.mk).
  const pEmail = `fg-${ts}@t.cz`;
  const reg = await api('POST', '/api/auth/register-promoter', {
    body: { email: pEmail, password: PW, name: 'FG', companyName: `FG ${ts}`, slug: `fg-${ts}` },
  });
  must('Promotér registrace', reg.status === 200, `promoterId=${reg.j?.promoterId}`);
  await api('POST', `/api/platform/promoters/${reg.j.promoterId}/approve`, { token: ma.accessToken });
  const pLogin = await login(pEmail);
  const P = pLogin?.accessToken;
  must('Promotér login (active)', !!P && (pLogin.roles?.promoterMemberships?.length ?? 0) > 0);

  // ════════ Festival: 2 dny × 2 zóny, ticket type scoped na Den 1 + Stage A ════════
  const fest = await api('POST', '/api/admin/events', {
    token: P,
    body: {
      title: `FG Festival ${ts}`,
      description: 'Dvoudenní festival, dvě pódia — gate enforcement test.',
      category: 'music',
      eventType: 'physical',
      currency: 'CZK',
      template: 'multi_day_festival',
      dateStart: '2026-12-15T12:00:00Z',
      dateEnd: '2026-12-16T23:00:00Z',
      days: [
        { label: 'Den 1', startsAt: '2026-12-15T12:00:00Z', endsAt: '2026-12-15T23:00:00Z' },
        { label: 'Den 2', startsAt: '2026-12-16T12:00:00Z', endsAt: '2026-12-16T23:00:00Z' },
      ],
      zones: [
        { name: 'Stage A', zoneType: 'stage' },
        { name: 'Stage B', zoneType: 'stage' },
      ],
      ticketTypes: [
        {
          name: 'Den 1 — Stage A',
          priceHalire: 30000,
          capacity: 50,
          isSeated: false,
          access: [{ dayIndex: 0, zoneName: 'Stage A', level: 'general' }],
        },
        {
          name: 'Full Pass',
          priceHalire: 80000,
          capacity: 50,
          isSeated: false,
          access: [{ dayIndex: 'all', zoneName: 'all', level: 'general' }],
        },
      ],
    },
  });
  const eventId = fest.j?.eventId || fest.j?.id;
  must('Festival vytvořen', !!eventId, eventId);
  await api('POST', `/api/platform/moderation/${eventId}/approve`, { token: ma.accessToken });

  // Den/zóna ID z DB.
  const days = await q<{ id: string; day_index: number }>(
    `SELECT id, day_index FROM catalog.event_days WHERE event_id = $1 ORDER BY day_index`,
    [eventId],
  );
  const zones = await q<{ id: string; name: string }>(
    `SELECT id, name FROM catalog.event_zones WHERE event_id = $1 ORDER BY display_order`,
    [eventId],
  );
  must('Festival má 2 dny', days.rows.length === 2, `${days.rows.length}`);
  must('Festival má 2 zóny', zones.rows.length === 2, `${zones.rows.length}`);
  const day1 = days.rows[0].id;
  const day2 = days.rows[1].id;
  const stageA = zones.rows.find((z) => z.name === 'Stage A')!.id;
  const stageB = zones.rows.find((z) => z.name === 'Stage B')!.id;

  const scopedTt = await q<{ id: string }>(
    `SELECT id FROM catalog.ticket_types WHERE event_id = $1 AND name LIKE 'Den 1%' LIMIT 1`,
    [eventId],
  );
  must('Scoped ticket type (Den 1 — Stage A) existuje', !!scopedTt.rows[0]?.id);
  const scopedTtId = scopedTt.rows[0].id;

  // ════════ 1–3: ticket_type_access matrix enforcement ════════
  console.log('\n━━━ 1–3. ticket_type_access (Den 1 + Stage A scoped) ━━━');
  const buy1 = await buyAndPay(eventId, scopedTtId, `fg-buyer1-${ts}@t.cz`);
  must('Scoped ticket koupen + vystaven', buy1.ok, `ticket=${buy1.ticketId}`);
  const tid1 = buy1.ticketId!;

  // (1) ADMIT na správný den + zónu. Scoped ticket → multi-day redemption flow
  //     (eventDayId přítomen → result 'admitted', kind 'multi_day_redemption').
  const okScan = await api('POST', '/api/admin/scanner/validate', {
    token: P,
    body: { ticketId: tid1, eventDayId: day1, zoneId: stageA },
  });
  check(
    '(1) ADMIT správný den+zóna (Den 1, Stage A)',
    okScan.j?.result === 'admitted',
    `status=${okScan.status} result=${okScan.j?.result}`,
  );
  const redemptions1 = await q<{ n: string }>(
    `SELECT COUNT(*)::text n FROM tickets.ticket_redemptions WHERE ticket_id = $1 AND event_day_id = $2`,
    [tid1, day1],
  );
  check('(1) DB: redemption Den 1 založen', Number(redemptions1.rows[0].n) === 1, `n=${redemptions1.rows[0].n}`);

  // (2) REJECT špatný den. Nový lístek (ať předchozí redemption nemate výsledek).
  const buy2 = await buyAndPay(eventId, scopedTtId, `fg-buyer2-${ts}@t.cz`);
  must('Druhý scoped ticket vystaven', buy2.ok, `ticket=${buy2.ticketId}`);
  const wrongDay = await api('POST', '/api/admin/scanner/validate', {
    token: P,
    body: { ticketId: buy2.ticketId, eventDayId: day2, zoneId: stageA },
  });
  check(
    '(2) REJECT špatný den (Den 2, Stage A)',
    wrongDay.status === 403 && wrongDay.j?.result === 'wrong_zone_or_day',
    `status=${wrongDay.status} result=${wrongDay.j?.result}`,
  );

  // (3) REJECT špatná zóna (Den 1 OK, Stage B mimo access).
  const wrongZone = await api('POST', '/api/admin/scanner/validate', {
    token: P,
    body: { ticketId: buy2.ticketId, eventDayId: day1, zoneId: stageB },
  });
  check(
    '(3) REJECT špatná zóna (Den 1, Stage B)',
    wrongZone.status === 403 && wrongZone.j?.result === 'wrong_zone_or_day',
    `status=${wrongZone.status} result=${wrongZone.j?.result}`,
  );
  const noRedemption = await q<{ n: string }>(
    `SELECT COUNT(*)::text n FROM tickets.ticket_redemptions WHERE ticket_id = $1`,
    [buy2.ticketId],
  );
  check('(2/3) DB: žádná redemption po reject', Number(noRedemption.rows[0].n) === 0, `n=${noRedemption.rows[0].n}`);

  // ════════ 4: per-ticket modular access má přednost ════════
  // Full Pass je wildcard přes ticket_type_access. Přepíšeme ho per-ticket
  // modular accessem (Den 1 × Stage B) — to MÁ PŘEDNOST nad ticket_type_access
  // (validate path 1). Pak: admit (Den 1, Stage B) ✅ / reject (Den 2, Stage A) ❌.
  console.log('\n━━━ 4. tickets.ticket_modular_access (per-ticket override) ━━━');
  const fullTt = await q<{ id: string }>(
    `SELECT id FROM catalog.ticket_types WHERE event_id = $1 AND name LIKE 'Full%' LIMIT 1`,
    [eventId],
  );
  const buyM = await buyAndPay(eventId, fullTt.rows[0].id, `fg-mod-${ts}@t.cz`);
  must('Full Pass koupen + vystaven', buyM.ok, `ticket=${buyM.ticketId}`);
  const tidM = buyM.ticketId!;
  await q(
    `INSERT INTO tickets.ticket_modular_access (ticket_id, event_day_id, zone_id, access_level)
     VALUES ($1, $2, $3, 'general')
     ON CONFLICT (ticket_id, event_day_id, zone_id) DO NOTHING`,
    [tidM, day1, stageB],
  );
  const modOk = await api('POST', '/api/admin/scanner/validate', {
    token: P,
    body: { ticketId: tidM, eventDayId: day1, zoneId: stageB },
  });
  check(
    '(4) ADMIT na per-ticket vybraný (Den 1, Stage B)',
    modOk.j?.result === 'admitted',
    `status=${modOk.status} result=${modOk.j?.result}`,
  );
  // Nový Full Pass ticket s modular access JEN na (Den 1, Stage B) → reject (Den 2, Stage A).
  const buyM2 = await buyAndPay(eventId, fullTt.rows[0].id, `fg-mod2-${ts}@t.cz`);
  must('Druhý Full Pass vystaven', buyM2.ok, `ticket=${buyM2.ticketId}`);
  await q(
    `INSERT INTO tickets.ticket_modular_access (ticket_id, event_day_id, zone_id, access_level)
     VALUES ($1, $2, $3, 'general')
     ON CONFLICT (ticket_id, event_day_id, zone_id) DO NOTHING`,
    [buyM2.ticketId, day1, stageB],
  );
  const modReject = await api('POST', '/api/admin/scanner/validate', {
    token: P,
    body: { ticketId: buyM2.ticketId, eventDayId: day2, zoneId: stageA },
  });
  check(
    '(4) REJECT per-ticket NEvybraný (Den 2, Stage A)',
    modReject.status === 403 && modReject.j?.result === 'wrong_zone_or_day',
    `status=${modReject.status} result=${modReject.j?.result}`,
  );

  // ════════ 5–8: RE-ENTRY state machine ════════
  // Re-entry sloupce nemají admin endpoint → nastavíme přímo v DB (jako
  // e2e-group-admit přepisuje orders.user_id). reentry_max_count=2 ⇒ povoluje
  // 2 entry skeny (první entry + jedno re-entry), pak limit.
  console.log('\n━━━ 5–8. Re-entry (entry → exit → re-entry, limity) ━━━');
  await q(`UPDATE catalog.events SET reentry_allowed = TRUE, reentry_max_count = 2 WHERE id = $1`, [eventId]);

  const buyRe = await buyAndPay(eventId, fullTt.rows[0].id, `fg-reentry-${ts}@t.cz`);
  must('Re-entry ticket vystaven', buyRe.ok, `ticket=${buyRe.ticketId}`);
  const tidRe = buyRe.ticketId!;

  // (5a) první entry → admitted, scan_count=1
  const e1 = await api('POST', '/api/admin/scanner/reentry', {
    token: P,
    body: { ticketId: tidRe, mode: 'entry' },
  });
  check(
    '(5) ENTRY #1 → admitted (inside)',
    e1.j?.result === 'admitted' && e1.j?.scanCount === 1,
    `result=${e1.j?.result} scanCount=${e1.j?.scanCount}`,
  );

  // (6) druhá entry bez exitu → already_inside (409)
  const e2 = await api('POST', '/api/admin/scanner/reentry', {
    token: P,
    body: { ticketId: tidRe, mode: 'entry' },
  });
  check(
    '(6) ENTRY #2 bez exitu → already_inside (409)',
    e2.status === 409 && e2.j?.result === 'already_inside',
    `status=${e2.status} result=${e2.j?.result}`,
  );

  // (5b) exit → exited (venku)
  const x1 = await api('POST', '/api/admin/scanner/reentry', {
    token: P,
    body: { ticketId: tidRe, mode: 'exit' },
  });
  check(
    '(5) EXIT → exited (venku)',
    x1.j?.result === 'exited',
    `status=${x1.status} result=${x1.j?.result}`,
  );

  // (7) exit znovu když venku → not_inside (409)
  const x2 = await api('POST', '/api/admin/scanner/reentry', {
    token: P,
    body: { ticketId: tidRe, mode: 'exit' },
  });
  check(
    '(7) EXIT znovu když venku → not_inside (409)',
    x2.status === 409 && x2.j?.result === 'not_inside',
    `status=${x2.status} result=${x2.j?.result}`,
  );

  // (5c) re-entry → admitted, scan_count=2 (== max), remaining 0
  const e3 = await api('POST', '/api/admin/scanner/reentry', {
    token: P,
    body: { ticketId: tidRe, mode: 'entry' },
  });
  check(
    '(5) RE-ENTRY → admitted (scan_count=2)',
    e3.j?.result === 'admitted' && e3.j?.scanCount === 2 && e3.j?.kind === 'reentry',
    `result=${e3.j?.result} scanCount=${e3.j?.scanCount} kind=${e3.j?.kind}`,
  );

  // (8) exit pak entry → reentry_limit_exceeded (scan_count 2 >= max 2)
  await api('POST', '/api/admin/scanner/reentry', { token: P, body: { ticketId: tidRe, mode: 'exit' } });
  const e4 = await api('POST', '/api/admin/scanner/reentry', {
    token: P,
    body: { ticketId: tidRe, mode: 'entry' },
  });
  check(
    '(8) RE-ENTRY přes max → reentry_limit_exceeded (409)',
    e4.status === 409 && e4.j?.result === 'reentry_limit_exceeded',
    `status=${e4.status} result=${e4.j?.result}`,
  );

  // (9) re-entry na akci BEZ reentry_allowed → reentry_disabled (422).
  console.log('\n━━━ 9. Re-entry na akci bez reentry_allowed ━━━');
  await q(`UPDATE catalog.events SET reentry_allowed = FALSE WHERE id = $1`, [eventId]);
  const buyNo = await buyAndPay(eventId, fullTt.rows[0].id, `fg-noreentry-${ts}@t.cz`);
  must('Ticket pro no-reentry test vystaven', buyNo.ok, `ticket=${buyNo.ticketId}`);
  const noRe = await api('POST', '/api/admin/scanner/reentry', {
    token: P,
    body: { ticketId: buyNo.ticketId, mode: 'entry' },
  });
  check(
    '(9) Re-entry na akci bez reentry_allowed → reentry_disabled (422)',
    noRe.status === 422 && noRe.j?.result === 'reentry_disabled',
    `status=${noRe.status} result=${noRe.j?.result}`,
  );

  // ════════ SOUHRN ════════
  console.log('\n═══ SOUHRN ═══');
  const pass = R.filter((r) => r.ok).length;
  const fail = R.filter((r) => !r.ok);
  console.log(`${pass}/${R.length} kontrol PROŠLO`);
  if (fail.length) {
    console.log('\n❌ SELHALO:');
    fail.forEach((f) => console.log('   •', f.l));
    process.exitCode = 1;
  } else {
    console.log('\n🎉 VŠE PROŠLO — festival gate (den/zóna) i re-entry stavový automat se vynucují.');
  }
}

main()
  .then(() => pool.end())
  .catch(async (e) => {
    console.error('\n💥', e instanceof Error ? e.message : e);
    await pool.end();
    process.exit(1);
  });
