// @vitest-environment node
/**
 * Runtime test 6 admin cest po přepojení guest-create na sdílený helper.
 *
 * Každá cesta se volá jako skutečný route handler proti ephemeral klonu prod
 * větve. Autentizace jde přes hlavičku `x-user-id` (viz `requirePromoter`).
 *
 * Vzor ověření u každé cesty:
 *   1) guest s tímhle e-mailem UŽ existuje (založený helperem) → cesta ho musí
 *      NAJÍT, ne založit druhého  → dedup
 *   2) po doběhnutí existuje právě 1 uživatel s tím e-mailem a objednávka
 *      (nebo ekvivalent) na něm visí → cesta doběhla celá
 *
 * Spuštění:
 *   NEON_API_KEY=... npx vitest run --config vitest.live.config.ts tests/admin-guest.live.test.ts
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NextRequest } from 'next/server';
import { Pool } from 'pg';
import { readFile } from 'fs/promises';
import { randomUUID } from 'crypto';
import { readdirSync } from 'fs';
import { join } from 'path';
import { createOrGetGuestUser } from '@/lib/identity/guest-user';

const NEON_API = 'https://console.neon.tech/api/v2';
const PROJECT = 'fragrant-wildflower-75132205';
const PARENT_BRANCH = 'br-rough-paper-alom0zky';
const DB_NAME = 'neondb';
const ROLE = 'neondb_owner';
// Migrace se ctou z disku — vlastni kopie seznamu znamenala, ze se tu
// nikdy neaplikovaly 453-459 a testy merily schema o devet migraci pozadu
// (FINDINGS 82: nastroj s kopii reality meri vedle).
const PENDING_MIGRATIONS = readdirSync(join('..', 'migrations'))
  .filter((f) => /^\d{3}_.*\.sql$/.test(f) && !f.startsWith('000_'))
  .sort();

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

describe.skipIf(!apiKey)('admin cesty — guest-create přes helper (live)', () => {
  let branchId: string | null = null;
  let pool: Pool;

  const run = `${Date.now()}`;
  const promoterId = randomUUID();
  const adminUserId = randomUUID();
  const venueId = randomUUID();
  const eventId = randomUUID();
  const ticketTypeId = randomUUID();
  const freeTypeId = randomUUID();
  const sessionId = randomUUID();
  const mail = (label: string) => `adm-${label}-${run}@tixly.test`;

  function req(url: string, method: string, body?: unknown): NextRequest {
    return new Request(url, {
      method,
      headers: { 'content-type': 'application/json', 'x-user-id': adminUserId },
      body: body === undefined ? undefined : JSON.stringify(body),
    }) as unknown as NextRequest;
  }

  async function usersWithEmail(email: string): Promise<string[]> {
    const r = await pool.query<{ id: string }>(
      `SELECT id FROM identity.users WHERE email = $1 AND anonymized_at IS NULL`,
      [email.toLowerCase()],
    );
    return r.rows.map((x) => x.id);
  }

  /** Objednávky navázané na daného uživatele u testovaného eventu. */
  async function ordersOf(userId: string): Promise<number> {
    const r = await pool.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM orders.orders WHERE user_id = $1 AND event_id = $2`,
      [userId, eventId],
    );
    return Number(r.rows[0].n);
  }

  beforeAll(async () => {
    const created = await neon(`/projects/${PROJECT}/branches`, {
      method: 'POST',
      body: JSON.stringify({
        branch: { parent_id: PARENT_BRANCH, name: `admin-guest-${run}` },
        endpoints: [{ type: 'read_write' }],
      }),
    });
    branchId = created.branch.id;
    await new Promise((r) => setTimeout(r, 4000));
    const { uri } = await neon(
      `/projects/${PROJECT}/connection_uri?branch_id=${branchId}&role_name=${ROLE}&database_name=${DB_NAME}`,
    );
    process.env.DATABASE_URL = uri;
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000';
    // Vydávání vstupenek šifruje TOTP secret — bez klíče route spadne (ENCRYPTION_KEY not set).
    process.env.ENCRYPTION_KEY ??= 'a'.repeat(64);

    pool = new Pool({ connectionString: uri, max: 4 });

    // Handlery jedou jako `tixly_app` (BYPASSRLS=false), tedy pod rolí, kterou
    // má používat produkce. `LIVE_AS_OWNER=1` to přepne na ownera — jen tam,
    // kde test měří něco jiného než oprávnění. Default se otočil, protože
    // owner RLS míjí a sada tím hlásila falešná PROŠLO (FINDINGS §77).
    if (process.env.LIVE_AS_OWNER !== '1') {
      const pw = `LiveTest_${randomUUID().slice(0, 12)}`;
      await pool.query(`ALTER ROLE tixly_app WITH PASSWORD '${pw}'`);
      process.env.DATABASE_URL = uri.replace(/\/\/[^@]+@/, `//tixly_app:${pw}@`);
    }
    console.log(`[live] role: ${process.env.LIVE_AS_OWNER === '1' ? 'neondb_owner (RLS SE NEMĚŘÍ)' : 'tixly_app'}`);
    for (const m of PENDING_MIGRATIONS) {
      await pool.query(await readFile(`../migrations/${m}`, 'utf8'));
    }

    // Neutralizace NESOUVISEJÍCÍ předexistující vady (RESET custom GUC → '' →
    // audit_log_actor_type_check). Detail v tests/checkout-guest.live.test.ts.
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

    // Promotér + admin uživatel s členstvím (kvůli requirePromoter)
    await pool.query(
      `INSERT INTO platform.promoters (id, email, name, slug, status)
       VALUES ($1, $2, 'Test promotér', $3, 'active')`,
      [promoterId, `pr-${run}@tixly.test`, `pr-${run}`],
    );
    await pool.query(
      `INSERT INTO identity.users (id, email, name, password_hash, gdpr_consent_at)
       VALUES ($1, $2, 'Admin', '!guest', NOW())`,
      [adminUserId, `admin-${run}@tixly.test`],
    );
    await pool.query(
      `INSERT INTO platform.promoter_members (promoter_id, user_id, role)
       VALUES ($1, $2, 'owner')`,
      [promoterId, adminUserId],
    );

    await pool.query(
      `INSERT INTO catalog.venues (id, name, city, country, capacity)
       VALUES ($1, 'Sál', 'Praha', 'CZ', 500)`,
      [venueId],
    );
    await pool.query(
      `INSERT INTO catalog.events
         (id, organizer_id, promoter_id, venue_id, title, slug, status, currency, event_type, date_start)
       VALUES ($1, $2, $2, $3, 'Akce', $4, 'published', 'CZK', 'concert', NOW() + INTERVAL '30 days')`,
      [eventId, promoterId, venueId, `ev-${run}`],
    );
    await pool.query(
      `INSERT INTO catalog.ticket_types
         (id, event_id, name, kind, base_price, total_qty, remaining_qty, visibility)
       -- Pozn.: kind='accreditation' NEEXISTUJE (ticket_types_kind_check povoluje jen
       -- standing/seated/season_pass/bundle), takže akreditační cesta může trefit
       -- jen fallback base_price = 0. Seedujeme tedy zero-price 'standing'.
       VALUES ($1, $3, 'Standard', 'standing', 50000, 200, 200, 'public'),
              ($2, $3, 'Akreditace', 'standing', 0, 100, 100, 'public')`,
      [ticketTypeId, freeTypeId, eventId],
    );
    await pool.query(
      `INSERT INTO orders.box_office_sessions (id, event_id, cashier_user_id, status)
       VALUES ($1, $2, $3, 'open')`,
      [sessionId, eventId, adminUserId],
    );
  }, 180_000);

  afterAll(async () => {
    if (pool) await pool.end().catch(() => undefined);
    // Route handlery si berou spojení z LÍNÉHO poolu v rls-pool, který tenhle
    // test nikdy nezavřel. Když se větev smaže pod otevřenými sockety, pg hodí
    // `Connection terminated unexpectedly` jako UNHANDLED error → vitest skončí
    // exit 1, i když všechny testy projdou. Zavřít ho MUSÍME před DELETE větve.
    try {
      const { db: appDb } = await import('@/lib/db/rls-pool');
      await appDb().end();
    } catch {
      /* pool se nikdy neinicializoval, nebo už je zavřený — nic k uklízení */
    }
    if (branchId) {
      await neon(`/projects/${PROJECT}/branches/${branchId}`, { method: 'DELETE' }).catch((e) =>
        console.error('[cleanup] větev nesmazána:', branchId, e),
      );
    }
  }, 60_000);

  it('comps — vytvoří guesta, druhé volání ho dedupne', async () => {
    const { POST } = await import('@/app/api/admin/events/[id]/comps/route');
    const email = mail('comps');
    const body = {
      ticketTypeId,
      recipientEmail: email,
      recipientName: 'Komplimentka Host',
      compType: 'vip' as const,
      quantity: 1,
    };

    const r1 = await POST(req(`http://x/api/admin/events/${eventId}/comps`, 'POST', body), {
      params: Promise.resolve({ id: eventId }),
    });
    expect(r1.status).toBeLessThan(400);

    const after1 = await usersWithEmail(email);
    expect(after1.length).toBe(1);
    expect(await ordersOf(after1[0])).toBe(1);

    // Druhá komplimentka témuž e-mailu → pořád jeden uživatel, dvě objednávky.
    const r2 = await POST(req(`http://x/api/admin/events/${eventId}/comps`, 'POST', body), {
      params: Promise.resolve({ id: eventId }),
    });
    expect(r2.status).toBeLessThan(400);

    const after2 = await usersWithEmail(email);
    expect(after2.length).toBe(1);
    expect(after2[0]).toBe(after1[0]);
    expect(await ordersOf(after2[0])).toBe(2);
  });

  it('guestlist — najde už existujícího guesta místo založení druhého', async () => {
    const { POST } = await import('@/app/api/admin/events/[id]/guestlist/route');
    const email = mail('guestlist');
    // Guest už existuje (jiná cesta ho založila dřív).
    const existingId = await createOrGetGuestUser(pool, { email, name: 'Původní' });

    const res = await POST(
      req(`http://x/api/admin/events/${eventId}/guestlist`, 'POST', {
        guestEmail: email,
        guestName: 'Host Ze Seznamu',
      }),
      { params: Promise.resolve({ id: eventId }) },
    );
    expect(res.status).toBeLessThan(400);

    const users = await usersWithEmail(email);
    expect(users).toEqual([existingId]); // dedup, žádný druhý řádek
    expect(await ordersOf(existingId)).toBe(1);
  });

  it('press — schválení akreditace vydá vstupenku existujícímu guestovi', async () => {
    const { PATCH } = await import('@/app/api/admin/events/[id]/press/route');
    const email = mail('press');
    const existingId = await createOrGetGuestUser(pool, { email, name: 'Novinář' });
    const accId = randomUUID();
    await pool.query(
      `INSERT INTO orders.press_accreditations
         (id, event_id, promoter_id, journalist_name, journalist_email, media_outlet, status)
       VALUES ($1, $2, $3, 'Jan Novinář', $4, 'Deník', 'pending')`,
      [accId, eventId, promoterId, email],
    );

    const res = await PATCH(
      req(`http://x/api/admin/events/${eventId}/press`, 'PATCH', {
        accreditationId: accId,
        status: 'approved',
      }),
      { params: Promise.resolve({ id: eventId }) },
    );
    expect(res.status).toBeLessThan(400);

    const users = await usersWithEmail(email);
    expect(users).toEqual([existingId]);
    expect(await ordersOf(existingId)).toBe(1);
  });

  it('accreditation — approve vydá comp ticket existujícímu guestovi', async () => {
    const { PATCH } = await import(
      '@/app/api/admin/events/[id]/accreditation/[reqId]/route'
    );
    const email = mail('accr');
    const existingId = await createOrGetGuestUser(pool, { email, name: 'Akreditovaný' });
    const reqId = randomUUID();
    await pool.query(
      `INSERT INTO marketing.accreditation_requests
         (id, event_id, applicant_email, applicant_name, category, status)
       VALUES ($1, $2, $3, 'Petra Akr', 'media', 'pending')`,
      [reqId, eventId, email],
    );

    const res = await PATCH(
      req(`http://x/api/admin/events/${eventId}/accreditation/${reqId}`, 'PATCH', {
        action: 'approve',
      }),
      { params: { id: eventId, reqId } },
    );
    expect(res.status).toBeLessThan(400);

    const users = await usersWithEmail(email);
    expect(users).toEqual([existingId]);
    expect(await ordersOf(existingId)).toBe(1);
  });

  it('waitlist — guest se najde, ale konverze padá na T-WAITLIST-PROVIDER (23514 walkin)', async () => {
    // ⚠️ AŽ SE TIKET T-WAITLIST-PROVIDER OPRAVÍ, TENTO TEST SPADNE — TO JE ZÁMĚR.
    // Tvrdí současný, rozbitý stav: guest-create přes helper projde, ale order
    // INSERT vloží payment_provider='walkin', které NENÍ v orders_payment_provider_check
    // (ani po čekající mig 451, ta přidala jen kiosk_card/reseller_cash) → 23514.
    // Konverze z waitlistu je tedy mrtvá funkce. Až migrace enum doplní, změň
    // asserty zpět na „status < 400 a 1 objednávka".
    const { PATCH } = await import('@/app/api/admin/events/[id]/waitlist/[entryId]/route');
    const email = mail('waitlist');
    const existingId = await createOrGetGuestUser(pool, { email, name: 'Čekatel' });
    const entryId = randomUUID();
    await pool.query(
      `INSERT INTO orders.waiting_list (id, event_id, email, name, position, status)
       VALUES ($1, $2, $3, 'Karel Čekatel', 1, 'waiting')`,
      [entryId, eventId, email],
    );

    // POZOR: tahle cesta chybu NEODCHYTÁVÁ. Jede v autocommitu (`db()`, bez BEGIN)
    // a order INSERT (:86) není v žádném try/catch, takže PG chyba probublá
    // z handleru VEN — `await PATCH(...)` hodí, nevrátí Response s 500.
    // Asertujeme tedy SQLSTATE přímo z routy, ne z náhradního probe INSERTu.
    let thrown: { code?: string; constraint?: string } | undefined;
    try {
      await PATCH(
        req(`http://x/api/admin/events/${eventId}/waitlist/${entryId}`, 'PATCH', {
          status: 'converted',
        }),
        { params: { id: eventId, entryId } },
      );
    } catch (e) {
      thrown = e as { code?: string; constraint?: string };
    }
    expect(thrown?.code).toBe('23514');
    expect(thrown?.constraint).toBe('orders_payment_provider_check');

    // Objednávka nevznikla.
    expect(await ordersOf(existingId)).toBe(0);

    // Guest-create ale proběhl a DEDUPNUL. Protože je cesta v autocommitu,
    // upsert se NEVRÁTÍ zpět (žádný rollback) → zůstává právě 1 uživatel.
    // Je to důkaz, že helper svou práci odvedl a blocker je až za ním —
    // a zároveň záznam, že cesta po sobě nechává částečný zápis.
    expect(await usersWithEmail(email)).toEqual([existingId]);
  });

  it('box-office — prodej padá na T-BOXOFFICE-EXPIRES (23502 expires_at)', async () => {
    // ⚠️ AŽ SE TIKET T-BOXOFFICE-EXPIRES OPRAVÍ, TENTO TEST SPADNE — TO JE ZÁMĚR.
    // Tvrdí současný, rozbitý stav: order INSERT (:89) neuvádí `expires_at`,
    // které je na orders.orders NOT NULL BEZ defaultu → 23502. Za tím číhá
    // DRUHÝ blocker: payment_provider='box_office' taky není v
    // orders_payment_provider_check → po doplnění expires_at spadne na 23514.
    // Pokladní prodej je tedy mrtvý na DVOU naskládaných blockerech.
    const { POST } = await import('@/app/api/admin/events/[id]/box-office/sell/route');
    const email = mail('boxoffice');
    const existingId = await createOrGetGuestUser(pool, { email, name: 'Původní Jméno' });

    const res = await POST(
      req(`http://x/api/admin/events/${eventId}/box-office/sell`, 'POST', {
        sessionId,
        ticketTypeId,
        quantity: 1,
        buyerEmail: email,
        buyerName: 'Jméno Od Pokladní',
      }),
      { params: { id: eventId } },
    );

    // Fail-closed: neuspěje, žádná objednávka.
    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(await ordersOf(existingId)).toBe(0);
    expect(await usersWithEmail(email)).toEqual([existingId]);

    // Jméno zůstalo původní — ale POZOR, NE proto, že by helper existující účet
    // nesahal. Tahle cesta má politiku `overwriteName` (reprodukuje původní
    // `DO UPDATE SET name = EXCLUDED.name`), takže přepis se ODEHRAJE; jen ho
    // ROLLBACK na :154 vrátí zpět, protože celá cesta je v BEGIN z :39.
    // Až se tiket opraví, jméno UŽ přepsané ZŮSTANE a tahle aserce spadne —
    // to je pak korektní signál k produktovému rozhodnutí o sjednocení politik.
    const nameRow = await pool.query<{ name: string }>(
      `SELECT name FROM identity.users WHERE id = $1`,
      [existingId],
    );
    expect(nameRow.rows[0].name).toBe('Původní Jméno');

    // Doložení PŘÍČINY: týž INSERT jako route (bez expires_at) → 23502.
    let err: { code?: string; column?: string } | undefined;
    try {
      await pool.query(
        `INSERT INTO orders.orders
           (user_id, event_id, status, total_amount, currency, payment_provider,
            is_box_office, box_office_session_id, idempotency_key)
         VALUES ($1,$2,'paid',50000,'CZK','box_office',true,$3,gen_random_uuid())`,
        [existingId, eventId, sessionId],
      );
    } catch (e) {
      err = e as { code?: string; column?: string };
    }
    expect(err?.code).toBe('23502');
    expect(err?.column).toBe('expires_at');
  });
});
