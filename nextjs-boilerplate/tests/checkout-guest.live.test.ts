// @vitest-environment node
/**
 * Runtime test CELÉ checkout cesty po přepojení guest-create na sdílený helper.
 *
 * Netestuje jen guest INSERT — volá skutečný route handler `POST /api/checkout`
 * proti ephemeral klonu produkční větve, takže projde celá operace (validace,
 * ceny, limity, rezervace inventáře, objednávka, položky, platba).
 *
 * Test je napsaný tak, aby dával STEJNÉ výsledky před i po přepojení — slouží
 * jako PŘED/PO srovnání. Spouští se dvakrát, jednou s `git stash` na
 * `src/app/api/checkout/route.ts` (viz zpráva k této změně).
 *
 * Spuštění:
 *   NEON_API_KEY=... npx vitest run --config vitest.live.config.ts tests/checkout-guest.live.test.ts
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NextRequest } from 'next/server';
import { Pool } from 'pg';
import { readFile } from 'fs/promises';
import { randomUUID } from 'crypto';

const NEON_API = 'https://console.neon.tech/api/v2';
const PROJECT = 'fragrant-wildflower-75132205';
const PARENT_BRANCH = 'br-rough-paper-alom0zky';
const DB_NAME = 'neondb';
const ROLE = 'neondb_owner';

/** Migrace, které ještě NEJSOU na produkci — klon je bez nich, checkout je potřebuje. */
const PENDING_MIGRATIONS = [
  '450_tickets_dedup_unique.sql',
  '451_orders_payment_provider_pos.sql',
  '452_tracking_events_provider_tiktok.sql',
];

const apiKey = process.env.NEON_API_KEY;

async function neon(path: string, init: RequestInit = {}) {
  const res = await fetch(NEON_API + path, {
    ...init,
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`Neon API ${res.status}: ${body}`);
  return body ? JSON.parse(body) : null;
}

describe.skipIf(!apiKey)('checkout — guest-create (live, celá cesta)', () => {
  let branchId: string | null = null;
  let pool: Pool;
  // Route handler bere NextRequest; ten dědí z Request, takže mu plain Request
  // za běhu stačí — přetypování je jen kvůli signatuře.
  let POST: (req: NextRequest) => Promise<Response>;

  const run = `${Date.now()}`;
  const promoterId = randomUUID();
  const venueId = randomUUID();
  const eventId = randomUUID();
  const ticketTypeId = randomUUID();
  const soldOutTypeId = randomUUID();
  const mail = (label: string) => `co-${label}-${run}@tixly.test`;

  async function postCheckout(body: Record<string, unknown>) {
    const req = new Request('http://localhost:3000/api/checkout', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const res = await POST(req as unknown as NextRequest);
    let json: Record<string, unknown> = {};
    try {
      json = await res.json();
    } catch {
      /* prázdné tělo */
    }
    return { status: res.status, json };
  }

  async function usersWithEmail(email: string): Promise<string[]> {
    const r = await pool.query<{ id: string }>(
      `SELECT id FROM identity.users WHERE email = $1 AND anonymized_at IS NULL`,
      [email],
    );
    return r.rows.map((x) => x.id);
  }

  beforeAll(async () => {
    const created = await neon(`/projects/${PROJECT}/branches`, {
      method: 'POST',
      body: JSON.stringify({
        branch: { parent_id: PARENT_BRANCH, name: `checkout-guest-${run}` },
        endpoints: [{ type: 'read_write' }],
      }),
    });
    branchId = created.branch.id;
    await new Promise((r) => setTimeout(r, 4000));
    const { uri } = await neon(
      `/projects/${PROJECT}/connection_uri?branch_id=${branchId}&role_name=${ROLE}&database_name=${DB_NAME}`,
    );

    // Route si pool bere z DATABASE_URL — musí být nastavené PŘED prvním dotazem.
    process.env.DATABASE_URL = uri;
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000';

    pool = new Pool({ connectionString: uri, max: 4 });

    // LIVE_AS_APP_ROLE=1 → handlery jedou jako tixly_app (BYPASSRLS=false),
    // tedy pod rolí, kterou má používat produkce. Default = neondb_owner.
    if (process.env.LIVE_AS_APP_ROLE === '1') {
      const pw = `LiveTest_${randomUUID().slice(0, 12)}`;
      await pool.query(`ALTER ROLE tixly_app WITH PASSWORD '${pw}'`);
      process.env.DATABASE_URL = uri.replace(/\/\/[^@]+@/, `//tixly_app:${pw}@`);
    }
    for (const m of PENDING_MIGRATIONS) {
      await pool.query(await readFile(`../migrations/${m}`, 'utf8'));
    }

    // NESOUVISEJÍCÍ PŘEDEXISTUJÍCÍ VADA — neutralizace, ne oprava.
    // `release()` v rls-pool dělá `RESET app.role`, jenže RESET u custom GUC
    // nenechá NULL, ale prázdný string. `audit_trigger_func` má
    // `COALESCE(current_setting('app.role',true),'system')`, což '' nechytí →
    // INSERT do orders.orders spadne na audit_log_actor_type_check (23514).
    // Projevuje se nahodile podle toho, které spojení z poolu se recykluje,
    // a je to vidět i BEZ téhle změny (ověřeno na původním kódu).
    // Tady na KLONU (nikde jinde) obalíme `current_setting` do NULLIF, aby '' spadlo
    // na 'system'. Jinak by ten šum přebil to, co tenhle test ověřuje (guest-create).
    // Je to zároveň kandidát na skutečnou opravu — patří do migrace, ne sem.
    await pool.query(`
      DO $patch$
      DECLARE src text;
      BEGIN
        SELECT pg_get_functiondef(oid) INTO src FROM pg_proc WHERE proname = 'audit_trigger_func';
        src := replace(
          src,
          'COALESCE(current_setting(''app.role'', TRUE), ''system'')',
          'COALESCE(NULLIF(current_setting(''app.role'', TRUE), ''''), ''system'')'
        );
        EXECUTE src;
      END
      $patch$;
    `);

    await pool.query(`INSERT INTO platform.promoters (id, email, name) VALUES ($1, $2, 'Test promotér')`, [
      promoterId,
      `promoter-${run}@tixly.test`,
    ]);
    await pool.query(
      `INSERT INTO catalog.venues (id, name, city, country, capacity) VALUES ($1, 'Sál', 'Praha', 'CZ', 500)`,
      [venueId],
    );
    await pool.query(
      `INSERT INTO catalog.events
         (id, organizer_id, promoter_id, venue_id, title, slug, status, currency, event_type, date_start)
       VALUES ($1, $2, $2, $3, 'Testovací akce', $4, 'published', 'CZK', 'concert', NOW() + INTERVAL '30 days')`,
      [eventId, promoterId, venueId, `ev-${run}`],
    );
    await pool.query(
      `INSERT INTO catalog.ticket_types
         (id, event_id, name, kind, base_price, total_qty, remaining_qty, visibility)
       VALUES ($1, $3, 'Standard', 'standing', 50000, 100, 100, 'public'),
              ($2, $3, 'Vyprodaný', 'standing', 50000, 10, 0, 'public')`,
      [ticketTypeId, soldOutTypeId, eventId],
    );

    ({ POST } = await import('@/app/api/checkout/route'));
  }, 180_000);

  afterAll(async () => {
    if (pool) await pool.end().catch(() => undefined);
    // Viz admin-guest.live.test.ts: líný pool z rls-pool musí zmizet PŘED
    // smazáním větve, jinak `Connection terminated unexpectedly` → exit 1.
    try {
      const { db: appDb } = await import('@/lib/db/rls-pool');
      await appDb().end();
    } catch {
      /* nikdy neinicializován / už zavřený */
    }
    if (branchId) {
      await neon(`/projects/${PROJECT}/branches/${branchId}`, { method: 'DELETE' }).catch((e) =>
        console.error('[cleanup] větev se nepodařilo smazat:', branchId, e),
      );
    }
  }, 60_000);

  it('nový kupující — checkout doběhne a založí guest usera', async () => {
    const email = mail('new');
    const { status, json } = await postCheckout({
      eventId,
      ticketTypeId,
      quantity: 1,
      buyerEmail: email,
      buyerName: 'Jan Kupující',
      paymentMethod: 'gopay',
    });

    expect(status).toBeLessThan(400);
    expect(json.orderId).toBeTruthy();

    const users = await usersWithEmail(email);
    expect(users.length).toBe(1);

    // Objednávka opravdu visí na tom guest userovi.
    const order = await pool.query<{ user_id: string }>(
      `SELECT user_id FROM orders.orders WHERE id = $1`,
      [json.orderId],
    );
    expect(order.rows[0].user_id).toBe(users[0]);

    // A má položky — tedy cesta doběhla celá, ne jen po guest INSERT.
    const items = await pool.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM orders.order_items WHERE order_id = $1`,
      [json.orderId],
    );
    expect(items.rows[0].n).toBe('1');
  });

  it('druhý nákup týmž e-mailem — dedup: druhá objednávka, pořád jeden user', async () => {
    const email = mail('dedup');

    const first = await postCheckout({
      eventId,
      ticketTypeId,
      quantity: 1,
      buyerEmail: email,
      buyerName: 'Opakovaný Kupec',
      paymentMethod: 'gopay',
    });
    expect(first.status).toBeLessThan(400);

    const second = await postCheckout({
      eventId,
      ticketTypeId,
      quantity: 1,
      buyerEmail: email,
      buyerName: 'Opakovaný Kupec',
      paymentMethod: 'gopay',
    });
    expect(second.status).toBeLessThan(400);
    expect(second.json.orderId).not.toBe(first.json.orderId);

    const users = await usersWithEmail(email);
    expect(users.length).toBe(1); // žádný duplikát

    const orders = await pool.query<{ user_id: string }>(
      `SELECT user_id FROM orders.orders WHERE id = ANY($1::uuid[])`,
      [[first.json.orderId, second.json.orderId]],
    );
    expect(orders.rows.length).toBe(2);
    expect(new Set(orders.rows.map((r) => r.user_id)).size).toBe(1);
    expect(orders.rows[0].user_id).toBe(users[0]);
  });

  it('selhání po guest-create (vyprodáno) — rollback smaže i guest usera', async () => {
    const email = mail('rollback');
    const { status } = await postCheckout({
      eventId,
      ticketTypeId: soldOutTypeId,
      quantity: 1,
      buyerEmail: email,
      buyerName: 'Neúspěšný Kupec',
      paymentMethod: 'gopay',
    });

    expect(status).toBeGreaterThanOrEqual(400);
    // Guest se zakládá PŘED rezervací inventáře → musí ho spolknout rollback.
    expect(await usersWithEmail(email)).toEqual([]);
  });

  it('velká písmena v e-mailu nevytvoří druhého uživatele', async () => {
    const email = mail('case');
    const a = await postCheckout({
      eventId,
      ticketTypeId,
      quantity: 1,
      buyerEmail: email,
      buyerName: 'Malá Písmena',
      paymentMethod: 'gopay',
    });
    expect(a.status).toBeLessThan(400);

    const b = await postCheckout({
      eventId,
      ticketTypeId,
      quantity: 1,
      buyerEmail: email.toUpperCase(),
      buyerName: 'Velká Písmena',
      paymentMethod: 'gopay',
    });
    expect(b.status).toBeLessThan(400);

    expect((await usersWithEmail(email)).length).toBe(1);
  });
});
