// @vitest-environment node
/**
 * Kolo 2 / krok 3 — V8: RLS musí bránit zápisu (i čtení) dat CIZÍHO tenanta.
 *
 * Audit (e2e_07b): `p_events_promoter_scope` a `p_ticket_types_event_scope` byly FOR ALL
 * s větví `status = 'published'` a bez WITH CHECK → kdokoli (i bez kontextu) přepsal
 * název publikované akce a ceny; `marketing.promo_codes` RLS neměla vůbec.
 *
 * Test běží přímo jako `tixly_app` (NOBYPASSRLS) — každý zápis v transakci s ROLLBACK,
 * měří se počet zasažených řádků / chyba RLS. Kontexty „uživatele A":
 *   - promotér A (app.current_promoter_id = A)
 *   - kupec A (app.current_user_id = A)
 *   - bez kontextu
 * Data tenantu B: publikovaná akce B, typ vstupenky B, sedadlo B, promo kód B,
 * objednávka a vstupenka kupce C na akci B.
 * Kontrola legitimity: promotér B své věci měnit smí.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool, type PoolClient } from 'pg';
import { createLocalClone, hasLocalDb, type LocalClone } from './helpers/local-fixture';

const run = describe.skipIf(!hasLocalDb);
const APP_URL = process.env.FIX_DB_APP_URL ?? 'postgresql://tixly_app:fixapp@localhost:55632/e2e';

type Ctx = { promoter?: string; user?: string; label: string };

run('Krok 3A — V8: zápis a čtení cizího tenanta pod tixly_app odepřen', () => {
  let clone: LocalClone;
  let owner: Pool;
  let app: Pool;
  let B: { promoterId: string; eventId: string; ticketTypeId: string; seatId: string; promoId: string; orderId: string; ticketId: string; buyerC: string };
  let A: { promoterId: string; userId: string };

  beforeAll(async () => {
    clone = await createLocalClone();
    owner = clone.pool;
    app = new Pool({ connectionString: APP_URL, max: 2 });
    // tenant B: publikovaná akce s vystavenou vstupenkou kupce C
    const fc = await clone.seed.fullChain({ totalQty: 10, remainingQty: 9, basePrice: 50000 });
    const seatId = (await owner.query<{ id: string }>(
      `INSERT INTO catalog.event_seats (event_id, ticket_type_id, sector, row, seat_number, status)
       VALUES ($1,$2,'B','1','1','available') RETURNING id`, [fc.eventId, fc.ticketTypeId])).rows[0].id;
    const promoId = (await owner.query<{ id: string }>(
      `INSERT INTO marketing.promo_codes (code, type, discount_value, created_by_organizer_id)
       VALUES ($1,'percentage',10,$2) RETURNING id`, [`V8B${Date.now()}`, fc.promoterId])).rows[0].id;
    const ticketId = (await owner.query<{ id: string }>(`SELECT id FROM tickets.tickets WHERE order_id=$1 LIMIT 1`, [fc.orderId])).rows[0].id;
    B = { promoterId: fc.promoterId, eventId: fc.eventId, ticketTypeId: fc.ticketTypeId, seatId, promoId, orderId: fc.orderId, ticketId, buyerC: fc.userId };
    const a = await clone.seed.chain();
    const ua = await clone.seed.user('buyerA', 'Kupec A');
    A = { promoterId: a.promoterId, userId: ua.id };
  }, 120_000);
  afterAll(async () => { await app?.end(); await clone?.cleanup(); }, 30_000);

  /** Spustí SQL jako tixly_app v daném kontextu, vždy ROLLBACK. Vrací rowCount nebo 'RLS' při odmítnutí. */
  async function as(ctx: Ctx, sql: string, params: unknown[] = []): Promise<number | 'RLS' | string> {
    const cl: PoolClient = await app.connect();
    try {
      await cl.query('BEGIN');
      await cl.query(
        `SELECT set_config('app.current_promoter_id',$1,true), set_config('app.current_user_id',$2,true),
                set_config('app.role',$3,true), set_config('app.is_platform_admin','',true)`,
        [ctx.promoter ?? '', ctx.user ?? '', ctx.promoter ? 'promoter' : ctx.user ? 'user' : ''],
      );
      const r = await cl.query(sql, params);
      return r.rowCount ?? 0;
    } catch (e) {
      const m = (e as Error).message;
      return /row-level security|permission denied/.test(m) ? 'RLS' : m;
    } finally {
      await cl.query('ROLLBACK').catch(() => {});
      cl.release();
    }
  }
  const denied = (v: number | string) => v === 0 || v === 'RLS';

  const ctxs = (): Ctx[] => [
    { promoter: A.promoterId, label: 'promotér A' },
    { user: A.userId, label: 'kupec A' },
    { label: 'bez kontextu' },
  ];

  it('akce B: UPDATE / DELETE / INSERT za tenanta B odepřeno', async () => {
    for (const c of ctxs()) {
      expect(await as(c, `UPDATE catalog.events SET title='HACK' WHERE id=$1`, [B.eventId]), `${c.label} UPDATE events`).toSatisfy(denied);
      expect(await as(c, `DELETE FROM catalog.events WHERE id=$1`, [B.eventId]), `${c.label} DELETE events`).toSatisfy(denied);
      expect(await as(c, `INSERT INTO catalog.events (organizer_id, promoter_id, title, slug, status, currency, event_type, date_start)
                          VALUES ($1,$1,'HACK',$2,'published','CZK','concert',now()+interval '9 days')`, [B.promoterId, `hack-${Date.now()}`]),
        `${c.label} INSERT events za B`).toSatisfy(denied);
    }
  });

  it('ceny B: UPDATE ticket_types / INSERT typu do akce B / sedadla odepřeno', async () => {
    for (const c of ctxs()) {
      expect(await as(c, `UPDATE catalog.ticket_types SET base_price=1 WHERE id=$1`, [B.ticketTypeId]), `${c.label} UPDATE price`).toSatisfy(denied);
      expect(await as(c, `INSERT INTO catalog.ticket_types (event_id, name, kind, base_price, total_qty, remaining_qty, visibility)
                          VALUES ($1,'HACK','standing',1,100,100,'public')`, [B.eventId]), `${c.label} INSERT type`).toSatisfy(denied);
      expect(await as(c, `DELETE FROM catalog.ticket_types WHERE id=$1`, [B.ticketTypeId]), `${c.label} DELETE type`).toSatisfy(denied);
      expect(await as(c, `UPDATE catalog.event_seats SET status='sold' WHERE id=$1`, [B.seatId]), `${c.label} UPDATE seat`).toSatisfy(denied);
    }
  });

  it('promo kódy B: čtení i zápis odepřen', async () => {
    for (const c of ctxs()) {
      expect(await as(c, `SELECT 1 FROM marketing.promo_codes WHERE id=$1`, [B.promoId]), `${c.label} SELECT promo`).toSatisfy(denied);
      expect(await as(c, `UPDATE marketing.promo_codes SET discount_value=100 WHERE id=$1`, [B.promoId]), `${c.label} UPDATE promo`).toSatisfy(denied);
      expect(await as(c, `DELETE FROM marketing.promo_codes WHERE id=$1`, [B.promoId]), `${c.label} DELETE promo`).toSatisfy(denied);
      expect(await as(c, `INSERT INTO marketing.promo_codes (code, type, discount_value, created_by_organizer_id) VALUES ($1,'free',0,$2)`,
        [`HACK${Date.now()}`, B.promoterId]), `${c.label} INSERT promo za B`).toSatisfy(denied);
    }
  });

  it('objednávky a vstupenky na akci B: čtení, změna, vložení odepřeno', async () => {
    for (const c of ctxs()) {
      expect(await as(c, `SELECT 1 FROM orders.orders WHERE id=$1`, [B.orderId]), `${c.label} SELECT order`).toSatisfy(denied);
      expect(await as(c, `UPDATE orders.orders SET status='refunded' WHERE id=$1`, [B.orderId]), `${c.label} UPDATE order`).toSatisfy(denied);
      expect(await as(c, `SELECT 1 FROM tickets.tickets WHERE id=$1`, [B.ticketId]), `${c.label} SELECT ticket`).toSatisfy(denied);
      expect(await as(c, `UPDATE tickets.tickets SET status='revoked' WHERE id=$1`, [B.ticketId]), `${c.label} UPDATE ticket`).toSatisfy(denied);
      // vložení objednávky do akce B (kupec A ji vkládá „sám sobě")
      expect(await as(c, `INSERT INTO orders.orders (user_id, event_id, status, total_amount, currency, expires_at)
                          VALUES ($1,$2,'paid',0,'CZK',now()+interval '1 day')`, [A.userId, B.eventId]), `${c.label} INSERT paid order do akce B`).toSatisfy(denied);
      expect(await as(c, `INSERT INTO orders.order_items (order_id, ticket_type_id, quantity, unit_price, total_price) VALUES ($1,$2,1,1,1)`,
        [B.orderId, B.ticketTypeId]), `${c.label} INSERT order_item do objednávky B`).toSatisfy(denied);
    }
  });

  it('legitimní: promotér B své akce, ceny a promo kódy měnit smí; veřejnost publikovanou akci čte', async () => {
    const pb: Ctx = { promoter: B.promoterId, label: 'promotér B' };
    expect(await as(pb, `UPDATE catalog.events SET title='Nový název' WHERE id=$1`, [B.eventId])).toBe(1);
    expect(await as(pb, `UPDATE catalog.ticket_types SET base_price=60000 WHERE id=$1`, [B.ticketTypeId])).toBe(1);
    expect(await as(pb, `UPDATE marketing.promo_codes SET discount_value=20 WHERE id=$1`, [B.promoId])).toBe(1);
    expect(await as(pb, `SELECT 1 FROM orders.orders WHERE id=$1`, [B.orderId])).toBe(1);
    expect(await as({ label: 'veřejnost' }, `SELECT 1 FROM catalog.events WHERE id=$1`, [B.eventId])).toBe(1);
    expect(await as({ label: 'veřejnost' }, `SELECT 1 FROM catalog.ticket_types WHERE id=$1`, [B.ticketTypeId])).toBe(1);
    expect(await as({ user: B.buyerC, label: 'kupec C' }, `SELECT 1 FROM orders.orders WHERE id=$1`, [B.orderId])).toBe(1);
  });
});
