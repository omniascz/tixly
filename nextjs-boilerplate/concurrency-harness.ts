/**
 * concurrency-harness.ts — Track B: souběžnostní testy invariantů ticketingu.
 *
 * Princip (dle zadání):
 *  - Golden path se volá PŘÍMÝM importem route handleru (`checkout` POST) —
 *    middleware SCHVÁLNĚ obcházíme; identitu vstříkneme hlavičkou `x-user-id`.
 *    (Buyer identitu ale checkout stejně odvozuje z `buyerEmail` — viz upsert
 *    v route.ts:877 — takže „týž kupující" = stejný buyerEmail.)
 *  - Collision engine = `Promise.all` N souběžných volání. Každé volání si bere
 *    vlastní connection z poolu (rls-pool `db().connect()` uvnitř handleru).
 *  - KAŽDÝ assert běží proti REÁLNÉMU STAVU DB (SELECT přes admin pool =
 *    bypassrls owner → ground truth), NIKDY proti odpovědi API.
 *  - Pojistka: odmítne běžet, pokud TEST_DATABASE_URL / TEST_ADMIN_DATABASE_URL
 *    vypadají jako produkce.
 *
 * Env:
 *   TEST_DATABASE_URL        — Neon prod-clone větev, role tixly_app (RLS platí).
 *                              Nastaví se jako DATABASE_URL pro handler.
 *   TEST_ADMIN_DATABASE_URL  — táž větev, role neondb_owner (seed + ground-truth asserty).
 *   PG_POOL_MAX              — (volitelně) app pool max; harness si ho zvedne dle N.
 *
 * Spuštění: viz KROK 3 (tsx s tsconfig paths). KROK 2 = jen napsat, NEspouštět.
 */

// ── Pojistka proti produkci (MUSÍ být před čímkoli, co sáhne na DB) ───────────
const PROD_MARKERS = [
  'ep-weathered-wind-alvbjysw', // prod endpoint host
  'br-rough-paper-alom0zky',    // prod branch id
];
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? '';
const TEST_ADMIN_DATABASE_URL = process.env.TEST_ADMIN_DATABASE_URL ?? '';

function assertNotProd(label: string, url: string): void {
  if (!url) throw new Error(`${label} není nastavené — odmítám běžet.`);
  for (const m of PROD_MARKERS) {
    if (url.includes(m)) {
      throw new Error(`${label} obsahuje prod marker "${m}" → ODMÍTÁM běžet proti produkci.`);
    }
  }
}
assertNotProd('TEST_DATABASE_URL', TEST_DATABASE_URL);
assertNotProd('TEST_ADMIN_DATABASE_URL', TEST_ADMIN_DATABASE_URL);

// Handler čte DATABASE_URL přes rls-pool (pool je líný → stačí nastavit teď,
// před prvním db() voláním). PG_POOL_MAX zvedneme, ať 20 souběžných opravdu jede.
process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.PG_POOL_MAX = process.env.PG_POOL_MAX ?? '30';
// mock brány povolené (checkout u gopay nevyžaduje, ale ať nic neblokuje)
process.env.ALLOW_MOCK_PAYMENTS = process.env.ALLOW_MOCK_PAYMENTS ?? 'true';
// order-completed guard + ticket issuer crypto (encryptSecret: sha256 fallback pokud ne 64-hex)
process.env.INTERNAL_SERVICE_TOKEN = process.env.INTERNAL_SERVICE_TOKEN ?? 'trackb-internal-token';
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { NextRequest } from 'next/server';

import { POST as checkoutPOST } from './src/app/api/checkout/route';
import { POST as orderCompletedPOST } from './src/app/api/internal/order-completed/route';
import { POST as seatHoldPOST } from './src/app/api/events/[id]/seats/hold/route';
import { db as appDb } from './src/lib/db/rls-pool';

const PROMOTER = '00000000-0000-4000-a000-000000000010';
const admin = new Pool({ connectionString: TEST_ADMIN_DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 5 });

// ── Golden-path volání (přímý import, x-user-id hlavička) ─────────────────────
interface CheckoutBody {
  eventId: string;
  ticketTypeId: string;
  quantity: number;
  buyerEmail: string;
  buyerName: string;
  seatHoldToken?: string;
  seatIds?: string[];
}
async function callCheckout(body: CheckoutBody, userId?: string): Promise<number> {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (userId) headers.set('x-user-id', userId); // identita přes hlavičku (middleware obcházíme)
  const req = new NextRequest('http://localhost/api/checkout', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const res = await checkoutPOST(req);
  return res.status; // jen pro diagnostiku; asert je vždy proti DB, ne proti tomuhle
}

// ── Zakladni akteri ──────────────────────────────────────────────────────────
// Harness byl psany proti PROD-KLONU, kde promoter s pevnym UUID uz existoval.
// Proti cistemu baseline klonu padal na FK `venues_promoter_id_fk`. Zalozeni je
// idempotentni, takze na prod-klonu se nic nezmeni.
async function ensureBaseActors(): Promise<void> {
  // vsechna pevna UUID, ktera harness pouziva jako aktery
  const ACTORS = [
    '00000000-0000-4000-a000-000000000002',
    '00000000-0000-4000-a000-000000000010',
  ];
  for (const id of ACTORS) {
    await admin.query(
      `INSERT INTO identity.users (id, email, name, gdpr_consent_at)
       VALUES ($1, $2, 'Harness Actor', now()) ON CONFLICT (id) DO NOTHING`,
      [id, `harness-${id.slice(-12)}@tixly.test`],
    );
  }
  await admin.query(
    `INSERT INTO platform.promoters (id, name, email)
     VALUES ($1, 'Harness Promoter', $2) ON CONFLICT (id) DO NOTHING`,
    [PROMOTER, `harness-p-${PROMOTER.slice(0, 8)}@tixly.test`],
  );
}

// ── Seed (admin/owner pool, dle prod NOT-NULL sloupců zjištěných v KROK 1) ─────
async function seedScenario(opts: {
  remainingQty: number;
  totalQty: number;
  maxPerBuyer?: number | null;
}): Promise<{ eventId: string; ticketTypeId: string }> {
  const tag = `trackb-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const venue = (await admin.query(
    // venues NOT NULL: name, city, country, capacity, promoter_id
    `INSERT INTO catalog.venues (name, city, country, capacity, promoter_id)
     VALUES ($1,'Praha','CZ',$2,$3) RETURNING id`,
    [`${tag}-venue`, opts.totalQty, PROMOTER],
  )).rows[0];
  const event = (await admin.query(
    // events NOT NULL: organizer_id, promoter_id, venue_id, title, date_start, slug, status
    // status='published' — checkout to vyžaduje (route.ts:334) + RLS ticket_types published větev
    `INSERT INTO catalog.events (organizer_id, promoter_id, venue_id, title, date_start, slug, status)
     VALUES ($1,$1,$2,$3, now() + interval '10 days', $4, 'published') RETURNING id`,
    [PROMOTER, venue.id, `${tag}-event`, `${tag}-event`],
  )).rows[0];
  const tt = (await admin.query(
    // ticket_types NOT NULL: event_id, name, kind, base_price, total_qty, remaining_qty
    // kind='standing' (GA); base_price v haléřích; max_per_buyer volitelný limit (§3.6)
    `INSERT INTO catalog.ticket_types (event_id, name, kind, base_price, total_qty, remaining_qty, max_per_buyer)
     VALUES ($1,'GA','standing',20000,$2,$3,$4) RETURNING id`,
    [event.id, opts.totalQty, opts.remainingQty, opts.maxPerBuyer ?? null],
  )).rows[0];
  return { eventId: event.id, ticketTypeId: tt.id };
}

// ── Ground-truth dotazy (admin pool = bypassrls owner → vidí VŠE) ─────────────
async function committedOrderCount(eventId: string): Promise<number> {
  // úspěšný checkout = commitnutá objednávka (pending) — neúspěch se rollbackne (route.ts:1894)
  return parseInt((await admin.query(
    `SELECT count(*)::text n FROM orders.orders WHERE event_id=$1 AND status IN ('pending','paid')`,
    [eventId],
  )).rows[0].n, 10);
}
async function remainingQty(ticketTypeId: string): Promise<number> {
  return (await admin.query(`SELECT remaining_qty FROM catalog.ticket_types WHERE id=$1`, [ticketTypeId])).rows[0].remaining_qty;
}
async function soldQtyForBuyer(ticketTypeId: string, buyerEmail: string): Promise<number> {
  // Ground truth pro „kolik koupil týž kupující". POZOR: prod `orders.orders` NEMÁ
  // sloupec `buyer_email` (checkout route.ts:896/922 na něj přesto odkazuje → 500).
  // Kupce proto identifikujeme přes user_id (checkout ho odvozuje email-upsertem, ř.877)
  // joinem na identity.users.email.
  return parseInt((await admin.query(
    `SELECT COALESCE(SUM(oi.quantity),0)::text AS n
       FROM orders.order_items oi
       JOIN orders.orders o ON o.id = oi.order_id
       JOIN identity.users u ON u.id = o.user_id
      WHERE oi.ticket_type_id = $1
        AND o.status IN ('pending','paid')
        AND LOWER(u.email) = LOWER($2)`,
    [ticketTypeId, buyerEmail],
  )).rows[0].n, 10);
}

// ── Útoky ─────────────────────────────────────────────────────────────────────
interface AttackResult { name: string; verdict: string; detail: string; statuses: Record<number, number>; }
const tally = (arr: number[]): Record<number, number> =>
  arr.reduce((a, s) => ((a[s] = (a[s] ?? 0) + 1), a), {} as Record<number, number>);

// A) Oversell GA (§3.1): remaining_qty=5, 20 souběžných checkoutů po 1 ks, různí kupci.
//    Invariant: přesně 5 uspěje, remaining skončí na 0, nikdy <0. Mapa čeká DRŽÍ.
//
// POZOR — A a B se ZÁMĚRNĚ nevolají z main(): už proběhly a jejich výsledky jsou
// ručně sepsané ve FINDINGS_CONCURRENCY.md:21-22 (A: `200×5, 409×15` → DRŽÍ;
// B: `500×5` → NEMĚŘITELNÉ). main() drží jen D/C, aby ten narativ nepřepsal
// (viz komentář u zápisu JSONu). Jsou `export`ované, aby bylo strojově zřejmé,
// že jde o retenci reproduceru, ne o mrtvý kód — NEMAZAT.
export async function attackA(): Promise<AttackResult> {
  const N = 20, STOCK = 5;
  const { eventId, ticketTypeId } = await seedScenario({ remainingQty: STOCK, totalQty: STOCK });
  const statuses = await Promise.all(
    Array.from({ length: N }, (_, i) =>
      callCheckout({ eventId, ticketTypeId, quantity: 1, buyerEmail: `a-${i}@trackb.test`, buyerName: `Buyer ${i}` },
        `00000000-0000-4000-a000-00000000${(2000 + i).toString().padStart(4, '0')}`)),
  );
  const orders = await committedOrderCount(eventId);
  const rem = await remainingQty(ticketTypeId);
  const held = orders === STOCK && rem === 0 && rem >= 0;
  return {
    name: 'A) Oversell GA (§3.1)',
    verdict: held ? 'DRŽÍ' : 'PRŮSTŘEL',
    detail: `stock=${STOCK}, ${N} souběžných po 1 ks → commitnutých objednávek=${orders} (čekáno ${STOCK}), remaining_qty=${rem} (čekáno 0, nikdy <0)`,
    statuses: tally(statuses),
  };
}

// B) Purchase-limit race (§3.6): max_per_buyer=2, týž kupující (stejný buyerEmail),
//    5 souběžných checkoutů po 1. Invariant: max 2 uspějí. Mapa čeká PRŮSTŘEL.
//
// ⏭️ ODLOŽENÝ RE-TEST, DNES ODBLOKOVANÝ: při původním běhu bylo B „NEMĚŘITELNÉ",
// protože purchase-limit dotaz padal na neexistujícím `orders.orders.buyer_email`
// (FINDINGS_CONCURRENCY.md:47 to vede jako odložený re-test §3.6). Ten bug byl
// mezitím opraven (`8af3b08` — OR-větev odstraněna jako redundantní), takže B se
// dnes už změřit dá a race §3.6 je pořád NEROZHODNUTÝ. NEMAZAT.
export async function attackB(): Promise<AttackResult> {
  const N = 5, LIMIT = 2, EMAIL = `buyer-b-${Date.now()}@trackb.test`;
  const { ticketTypeId } = await seedScenario({ remainingQty: 100, totalQty: 100, maxPerBuyer: LIMIT });
  const eventId = (await admin.query(`SELECT event_id FROM catalog.ticket_types WHERE id=$1`, [ticketTypeId])).rows[0].event_id;
  const statuses = await Promise.all(
    Array.from({ length: N }, () =>
      callCheckout({ eventId, ticketTypeId, quantity: 1, buyerEmail: EMAIL, buyerName: 'Same Buyer' },
        '00000000-0000-4000-a000-000000000002')),
  );
  const sold = await soldQtyForBuyer(ticketTypeId, EMAIL); // ground truth přes reálný SUM
  const orders = await committedOrderCount(eventId);
  const st = tally(statuses);
  const all5xx = statuses.every((s) => s >= 500);
  let verdict: string;
  let detail: string;
  if (orders === 0 && all5xx) {
    // Checkout umřel na chybějícím sloupci → limit se nikdy nevyhodnotí. NENÍ to „DRŽÍ".
    verdict = 'NEMĚŘITELNÉ (checkout 500)';
    detail = `max_per_buyer=${LIMIT}, ${N} souběžných po 1 → VŠECH ${N} checkoutů skončilo 5xx a 0 objednávek. Příčina: purchase-limit dotaz (route.ts:896/922) odkazuje na neexistující sloupec orders.orders.buyer_email → INTERNAL 500. Race nelze změřit, protože feature je rozbitá proti prod schématu.`;
  } else {
    const held = sold <= LIMIT;
    verdict = held ? 'DRŽÍ' : 'PRŮSTŘEL';
    detail = `max_per_buyer=${LIMIT}, ${N} souběžných po 1 (týž buyerEmail) → reálně prodáno kupci=${sold} ks, commitnutých objednávek=${orders} (invariant ≤ ${LIMIT})`;
  }
  return { name: 'B) Purchase-limit race (§3.6)', verdict, detail, statuses: st };
}

// E) Party-split slot race: N souběžných přijetí na TÝŽ share_token, ale slotů
//    je míň než požadavků. Sekvenční test (party-split.live.test.ts) oversell
//    z principu nechytí — sloty se rozdávají pod `FOR UPDATE SKIP LOCKED`
//    a ten se projeví teprve pod souběhem.
//
//    Invarianty:
//      • počet 200 == počet volných slotů (ani víc, ani míň)
//      • žádný slotIndex dvakrát
//      • remaining_qty klesne PŘESNĚ o počet přijatých slotů
export async function attackE(): Promise<AttackResult> {
  const N = 10, SLOTS = 3;
  const { eventId, ticketTypeId } = await seedScenario({ remainingQty: 100, totalQty: 100 });
  // party-split create INNER JOINuje catalog.productions (pr.id = e.production_id),
  // takže akce BEZ produkce vrátí 404 — seedScenario ji nezakládá.
  const prod = (await admin.query(
    `INSERT INTO catalog.productions (promoter_id, title) VALUES ($1,'Harness prod') RETURNING id`,
    [PROMOTER])).rows[0];
  await admin.query(`UPDATE catalog.events SET production_id = $1 WHERE id = $2`, [prod.id, eventId]);

  // session se zakládá přes REÁLNÝ handler, ne INSERTem — ať platí táž cesta
  const { POST: create } = await import('@/app/api/checkout/party-split/route');
  const cres = await create(new Request('http://localhost:3000/api/checkout/party-split', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-user-id': PROMOTER },
    body: JSON.stringify({
      eventId, ticketTypeId, totalSlots: SLOTS,
      organizerEmail: `ps-org-${Date.now()}@trackb.test`, organizerName: 'Org',
    }),
  }) as never);
  const createdBody = await cres.json() as { shareToken?: string };
  const token = createdBody.shareToken as string;
  if (!token) {
    return { name: 'E) Party-split slot race', verdict: 'NEMĚŘITELNÉ',
      detail: `session se nezaložila: HTTP ${cres.status} ${JSON.stringify(createdBody).slice(0, 160)}`,
      statuses: { [cres.status]: 1 } };
  }

  const before = await remainingQty(ticketTypeId);
  const { POST: pay } = await import('@/app/api/checkout/party-split/[token]/route');
  const results = await Promise.all(
    Array.from({ length: N }, (_, i) =>
      pay(new Request(`http://localhost:3000/api/party/${token}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          payerEmail: `ps-${i}-${Date.now()}@trackb.test`, payerName: `Payer ${i}`,
          paymentMethod: 'gopay', locale: 'cs',
        }),
      }) as never, { params: Promise.resolve({ token }) } as never)
        .then(async (r) => ({ status: r.status, body: await r.json() as { slotIndex?: number } }))
        .catch(() => ({ status: 599, body: {} as { slotIndex?: number } }))),
  );
  const after = await remainingQty(ticketTypeId);
  const ok = results.filter((r) => r.status === 200);
  const slotIdx = ok.map((r) => r.body.slotIndex).filter((x) => x !== undefined);
  const uniqueSlots = new Set(slotIdx).size;
  const drop = before - after;

  const held = ok.length === SLOTS && uniqueSlots === ok.length && drop === ok.length;
  return {
    name: 'E) Party-split slot race',
    verdict: held ? 'DRŽÍ' : 'PRŮSTŘEL',
    detail: `${SLOTS} volných slotů, ${N} souběžných přijetí → 200×${ok.length} (čekáno ${SLOTS}), `
      + `unikátních slotIndex=${uniqueSlots} (čekáno ${ok.length}, žádný dvakrát), `
      + `remaining_qty ${before}→${after} (pokles ${drop}, čekáno ${ok.length})`,
    statuses: tally(results.map((r) => r.status)),
  };
}

// ── Golden-path volání pro D/C (order-completed, seat hold) ───────────────────
async function callOrderCompleted(orderId: string): Promise<number> {
  const req = new NextRequest('http://localhost/api/internal/order-completed', {
    method: 'POST',
    headers: new Headers({ 'content-type': 'application/json', 'x-internal-token': process.env.INTERNAL_SERVICE_TOKEN ?? '' }),
    body: JSON.stringify({ orderId }),
  });
  return (await orderCompletedPOST(req)).status;
}
async function callSeatHold(eventId: string, seatIds: string[], userId: string): Promise<string | null> {
  const req = new NextRequest(`http://localhost/api/events/${eventId}/seats/hold`, {
    method: 'POST',
    headers: new Headers({ 'content-type': 'application/json', 'x-user-id': userId }),
    body: JSON.stringify({ seatIds }),
  });
  const res = await seatHoldPOST(req, { params: Promise.resolve({ id: eventId }) });
  if (res.status !== 200) { console.error('[seedC] seat hold status', res.status, await res.text()); return null; }
  return (await res.json() as { holdToken: string }).holdToken;
}

// Seed: 'paid' objednávka s M lístky k vydání (order_items.quantity = M).
async function seedPaidOrder(M: number): Promise<{ orderId: string }> {
  const { eventId, ticketTypeId } = await seedScenario({ remainingQty: 100, totalQty: 100 });
  const order = (await admin.query(
    // orders NOT NULL bez defaultu: user_id, total_amount, expires_at (+ status='paid')
    `INSERT INTO orders.orders (user_id, event_id, status, total_amount, currency, expires_at)
     VALUES ('00000000-0000-4000-a000-000000000002', $1, 'paid', $2, 'CZK', now() + interval '1 day') RETURNING id`,
    [eventId, 20000 * M],
  )).rows[0];
  await admin.query(
    `INSERT INTO orders.order_items (order_id, ticket_type_id, quantity, unit_price, total_price)
     VALUES ($1, $2, $3, 20000, $4)`,
    [order.id, ticketTypeId, M, 20000 * M],
  );
  return { orderId: order.id };
}

// Seed: seated ticket_type + 1 sedadlo (available) navázané na tento typ.
async function seedSeatedSeat(): Promise<{ eventId: string; ticketTypeId: string; seatId: string }> {
  const tag = `trackc-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const venue = (await admin.query(`INSERT INTO catalog.venues (name,city,country,capacity,promoter_id) VALUES ($1,'Praha','CZ',100,$2) RETURNING id`, [`${tag}-v`, PROMOTER])).rows[0];
  const event = (await admin.query(`INSERT INTO catalog.events (organizer_id,promoter_id,venue_id,title,date_start,slug,status) VALUES ($1,$1,$2,$3,now()+interval '10 days',$4,'published') RETURNING id`, [PROMOTER, venue.id, `${tag}-e`, `${tag}-e`])).rows[0];
  const tt = (await admin.query(`INSERT INTO catalog.ticket_types (event_id,name,kind,base_price,total_qty,remaining_qty,is_seated) VALUES ($1,'Seated','seated',20000,5,5,true) RETURNING id`, [event.id])).rows[0];
  const seat = (await admin.query(`INSERT INTO catalog.event_seats (event_id,sector,row,seat_number,ticket_type_id,status) VALUES ($1,'A','1','1',$2,'available') RETURNING id`, [event.id, tt.id])).rows[0];
  return { eventId: event.id, ticketTypeId: tt.id, seatId: seat.id };
}

// D) Double issuance (§3.4): 1 paid order s M lístky, 2× order-completed SOUČASNĚ.
//    Invariant: tickets(order_id) == M, ne 2M. Mapa čeká PRŮSTŘEL (žádný lock/UNIQUE).
async function attackD(): Promise<AttackResult> {
  const M = 3;
  const { orderId } = await seedPaidOrder(M);
  const statuses = await Promise.all([callOrderCompleted(orderId), callOrderCompleted(orderId)]);
  const tix = parseInt((await admin.query(`SELECT count(*)::text n FROM tickets.tickets WHERE order_id=$1`, [orderId])).rows[0].n, 10);
  let verdict: string;
  if (tix > M) verdict = 'PRŮSTŘEL';
  else if (tix === M) verdict = 'DRŽÍ';
  else verdict = `ANOMÁLIE (tix=${tix} < M)`;
  return {
    name: 'D) Double issuance (§3.4)',
    verdict,
    detail: `M=${M}, 2× order-completed(orderId) SOUČASNĚ → tickets WHERE order_id=X = ${tix} (invariant ${M}; průstřel = ${2 * M})`,
    statuses: tally(statuses),
  };
}

// C) Seat double-sell (§3.2): 1 held seat, 2 souběžné checkouty na TÝŽ seat.
//    Invariant: sold-seatů == 1, max 1 checkout 2xx (druhý 409). Mapa čeká DRŽÍ (FOR UPDATE).
async function attackC(): Promise<AttackResult> {
  const { eventId, ticketTypeId, seatId } = await seedSeatedSeat();
  const holdToken = await callSeatHold(eventId, [seatId], '00000000-0000-4000-a000-000000000002');
  if (!holdToken) return { name: 'C) Seat double-sell (§3.2)', verdict: 'CHYBA SEED (hold selhal)', detail: 'seat hold nevrátil token', statuses: {} };
  const statuses = await Promise.all([
    callCheckout({ eventId, ticketTypeId, quantity: 1, buyerEmail: `c1-${Date.now()}@trackb.test`, buyerName: 'C1', seatHoldToken: holdToken, seatIds: [seatId] }),
    callCheckout({ eventId, ticketTypeId, quantity: 1, buyerEmail: `c2-${Date.now()}@trackb.test`, buyerName: 'C2', seatHoldToken: holdToken, seatIds: [seatId] }),
  ]);
  const sold = parseInt((await admin.query(`SELECT count(*)::text n FROM catalog.event_seats WHERE id=$1 AND status='sold'`, [seatId])).rows[0].n, 10);
  const twoxx = statuses.filter((s) => s >= 200 && s < 300).length;
  const all5xx = statuses.every((s) => s >= 500);
  let verdict: string;
  let detail: string;
  if (sold === 0 && twoxx === 0 && all5xx) {
    // Seated checkout umřel dřív, než se seat lock (FOR UPDATE) vůbec vyzkoušel. NENÍ to průstřel.
    verdict = 'NEMĚŘITELNÉ (checkout 500)';
    detail = `1 held seat, 2 souběžné checkouty → oba 5xx, sold-seatů=0. Příčina: seated checkout (route.ts:655 a :710) čte sloupce x, y, které v catalog.event_seats NEEXISTUJÍ (jsou x_coord, y_coord) → column "x" does not exist → 500. Double-sell race nelze změřit, seated checkout je rozbitý proti prod schématu.`;
  } else {
    const held = sold === 1 && twoxx <= 1;
    verdict = held ? 'DRŽÍ' : 'PRŮSTŘEL';
    detail = `1 held seat, 2 souběžné checkouty na týž seat → sold-seatů=${sold} (invariant 1), 2xx=${twoxx} (max 1)`;
  }
  return { name: 'C) Seat double-sell (§3.2)', verdict, detail, statuses: tally(statuses) };
}

// ── Main + zápis FINDINGS ─────────────────────────────────────────────────────
async function main(): Promise<void> {
  const branchHost = (TEST_DATABASE_URL.match(/@([^/]+)\//)?.[1]) ?? '(neznámý host)';
  console.log(`[harness] cíl: ${branchHost} (ověřeno: není prod)`);
  await ensureBaseActors();
  const results: AttackResult[] = [];
  // A a B se driv nevolaly (blokator §3.6 padl az 8af3b08). Ted uz jde pustit
  // cely harness najednou — jeden ucelenzy obraz concurrency vrstvy.
  results.push(await attackA());
  results.push(await attackB());
  results.push(await attackD());
  results.push(await attackC());
  results.push(await attackE());

  // POZOR: NEpřepisujeme FINDINGS_CONCURRENCY.md (obsahuje ručně psanou A/B/P1 analýzu).
  // D/C výsledky vypíšeme na stdout + uložíme JSON do scratchpadu; integraci do FINDINGS
  // udělá člověk ručně (kontrola narativu, jako u A/B).
  console.log('\n===== VÝSLEDKY A–E (assert proti reálné DB) =====');
  for (const r of results) {
    const st = Object.entries(r.statuses).map(([k, v]) => `${k}×${v}`).join(', ');
    console.log(`  ${r.name}: ${r.verdict}\n    ${r.detail}\n    HTTP: ${st}`);
  }
  const out = resolve(process.cwd(), '..', '_trackb_dc_results.json');
  writeFileSync(out, JSON.stringify(results, null, 2), 'utf8');
  console.log(`[harness] JSON: ${out}`);

  await admin.end();
  await appDb().end();
}

main().then(() => process.exit(0)).catch((e) => { console.error('[harness] CHYBA:', e); process.exit(1); });
