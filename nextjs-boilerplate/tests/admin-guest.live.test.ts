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
import { randomUUID } from 'crypto';
import { createOrGetGuestUser } from '@/lib/identity/guest-user';
import { createLiveClone, hasLiveDb, type LiveClone } from './helpers/live-fixture';




describe.skipIf(!hasLiveDb)('admin cesty — guest-create přes helper (live)', () => {
  let clone: LiveClone | undefined;
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
    // Kolo 14 / krok 4: sdílená dráha — Neon klon, nebo bez NEON_API_KEY lokální DB z migrací (FIX_E2E=1)
    clone = await createLiveClone('admin-guest');
    pool = clone.pool;

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
      `INSERT INTO platform.promoters (id, email, name, slug, status, company_dic)
       VALUES ($1, $2, 'Test promotér', $3, 'active', 'CZ12345678')`, // kolo 14: DIČ plátce (C-54)
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
         (id, event_id, name, kind, base_price, total_qty, remaining_qty, visibility, vat_rate_code)
       -- Pozn.: kind='accreditation' NEEXISTUJE (ticket_types_kind_check povoluje jen
       -- standing/seated/season_pass/bundle), takže akreditační cesta může trefit
       -- jen fallback base_price = 0. Seedujeme tedy zero-price 'standing'.
       VALUES ($1, $3, 'Standard', 'standing', 50000, 200, 200, 'public', 'CZ_REDUCED'),
              ($2, $3, 'Akreditace', 'standing', 0, 100, 100, 'public', 'CZ_REDUCED')`,
      [ticketTypeId, freeTypeId, eventId],
    );
    await pool.query(
      `INSERT INTO orders.box_office_sessions (id, event_id, cashier_user_id, status)
       VALUES ($1, $2, $3, 'open')`,
      [sessionId, eventId, adminUserId],
    );
  }, 180_000);

  afterAll(async () => {
    await clone?.cleanup();
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
      { params: Promise.resolve({ id: eventId, reqId }) },
    );
    expect(res.status).toBeLessThan(400);

    const users = await usersWithEmail(email);
    expect(users).toEqual([existingId]);
    expect(await ordersOf(existingId)).toBe(1);
  });

  it('waitlist — guest se najde a konverze založí objednávku (T-WAITLIST-PROVIDER opraven)', async () => {
    // Kolo 14 / krok 4: test dřív tvrdil rozbitý stav (23514 walkin) s pokynem „až se tiket opraví, změň asserty
    // zpět na status < 400 a 1 objednávka". Převod na lokální DB z migrací ukázal, že je opraveno — asserty proto
    // tvrdí funkční konverzi.
    const { PATCH } = await import('@/app/api/admin/events/[id]/waitlist/[entryId]/route');
    const email = mail('waitlist');
    const existingId = await createOrGetGuestUser(pool, { email, name: 'Čekatel' });
    const entryId = randomUUID();
    await pool.query(
      `INSERT INTO orders.waiting_list (id, event_id, email, name, position, status)
       VALUES ($1, $2, $3, 'Karel Čekatel', 1, 'waiting')`,
      [entryId, eventId, email],
    );
    const res = await PATCH(
      req(`http://x/api/admin/events/${eventId}/waitlist/${entryId}`, 'PATCH', { status: 'converted' }),
      { params: Promise.resolve({ id: eventId, entryId }) },
    );
    expect(res.status, await res.clone().text()).toBeLessThan(400);
    expect(await ordersOf(existingId)).toBe(1);
    // guest-create dedupnul na existujícího uživatele
    expect(await usersWithEmail(email)).toEqual([existingId]);
  });

  it('box-office — prodej projde a dedupne existujícího guesta (T-BOXOFFICE-EXPIRES opraven)', async () => {
    // Kolo 14 / krok 4: test dřív tvrdil rozbitý stav (23502 expires_at, za ním 23514 payment_provider) s poznámkou
    // „až se tiket opraví, tento test spadne". Převod na lokální DB z migrací ukázal, že pokladní prodej funguje
    // (dřívější 422 byl jen seed bez sazby DPH) — asserty tvrdí funkční prodej.
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
      { params: Promise.resolve({ id: eventId }) },
    );
    expect(res.status, await res.clone().text()).toBeLessThan(400);
    const body = (await res.json()) as { orderId: string; tickets: unknown[] };
    expect(body.tickets).toHaveLength(1);
    expect(await ordersOf(existingId)).toBe(1);
    expect(await usersWithEmail(email)).toEqual([existingId]);

    // Objednávka je zaplacená pokladní objednávka s vyplněným expires_at (dřív NOT NULL bez hodnoty → 23502).
    const o = await pool.query<{ status: string; payment_provider: string; is_box_office: boolean; has_exp: boolean }>(
      `SELECT status, payment_provider, is_box_office, expires_at IS NOT NULL AS has_exp FROM orders.orders WHERE id = $1`,
      [body.orderId],
    );
    expect(o.rows[0]).toMatchObject({ status: 'paid', is_box_office: true, has_exp: true });

    // Politika cesty je `overwriteName` (`SET name = EXCLUDED.name`), ale trigger identity.sync_user_name (mig 302)
    // při UPDATE dopočítá name z EXISTUJÍCÍCH first_name/last_name → jméno účtu zůstane původní. Ověřeno živě
    // (kolo 14 / krok 4). Pokladní prodej tedy jméno registrovaného zákazníka NEpřepíše; změna je produktové
    // rozhodnutí mimo kolo 14.
    const nameRow = await pool.query<{ name: string }>(`SELECT name FROM identity.users WHERE id = $1`, [existingId]);
    expect(nameRow.rows[0].name).toBe('Původní Jméno');
  });
});
