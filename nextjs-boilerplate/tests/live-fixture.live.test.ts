// @vitest-environment node
/**
 * Smoke test SEED FACTORY samotné.
 *
 * Seed, kterému nikdo nevěří, je stejně bezcenný jako dokumentace, které nikdo
 * nevěří. Tenhle test dokazuje, že factory vyrobí řetěz, který PROJDE proti
 * reálnému schématu — hlavně že lístek má vyplněné crypto sloupce, protože ty
 * jsou právě to, na čem se každý ručně psaný seed zasekl.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';

import { createLiveClone, makeSeed, hasLiveDb, type LiveClone, type Seed } from './helpers/live-fixture';

describe.skipIf(!hasLiveDb)('live-fixture seed factory', () => {
  let clone: LiveClone;
  let pool: Pool;
  let seed: Seed;

  beforeAll(async () => {
    clone = await createLiveClone('seed-smoke');
    pool = clone.pool;
    seed = makeSeed(pool);
  }, 180_000);

  afterAll(async () => {
    await clone?.cleanup();
  }, 60_000);

  it('chain() vyrobí promoter → venue → event → ticket_type', async () => {
    const c = await seed.chain({ remainingQty: 7, totalQty: 10, basePrice: 25000 });

    const ev = await pool.query<{ promoter_id: string; status: string; currency: string }>(
      `SELECT promoter_id, status, currency FROM catalog.events WHERE id = $1`,
      [c.eventId],
    );
    expect(ev.rows).toHaveLength(1);
    expect(ev.rows[0].promoter_id).toBe(c.promoterId);
    expect(ev.rows[0].status).toBe('published');

    const tt = await pool.query<{ remaining_qty: number; base_price: number }>(
      `SELECT remaining_qty, base_price FROM catalog.ticket_types WHERE id = $1`,
      [c.ticketTypeId],
    );
    expect(tt.rows[0].remaining_qty).toBe(7);
    expect(tt.rows[0].base_price).toBe(25000);

    // promoter_members vazba — bez ní neprojdou admin cesty za runAsPromoter
    const pm = await pool.query(
      `SELECT 1 FROM platform.promoter_members WHERE promoter_id=$1 AND user_id=$2`,
      [c.promoterId, c.adminUserId],
    );
    expect(pm.rows).toHaveLength(1);
  });

  it('user() jde přes createOrGetGuestUser — dedupuje a má gdpr_consent_at', async () => {
    const { createOrGetGuestUser } = await import('@/lib/identity/guest-user');
    const u = await seed.user('dedup', 'Dedup Tester');
    const again = await createOrGetGuestUser(pool, { email: u.email, name: 'Jiné jméno' });
    expect(again).toBe(u.id);

    const row = await pool.query<{ gdpr_consent_at: string | null; name: string }>(
      `SELECT gdpr_consent_at, name FROM identity.users WHERE id = $1`,
      [u.id],
    );
    expect(row.rows[0].gdpr_consent_at).not.toBeNull();
    // default politika `touch` existující jméno nepřepisuje
    expect(row.rows[0].name).toBe('Dedup Tester');
  });

  it('fullChain() vydá lístek PRODUKČNÍ cestou včetně crypto sloupců', async () => {
    const f = await seed.fullChain({ remainingQty: 5, totalQty: 5 });
    expect(f.tickets.length).toBeGreaterThan(0);

    const t = await pool.query<{
      status: string;
      owner_id: string;
      original_owner_id: string;
      totp_secret_encrypted: Buffer;
      totp_secret_iv: Buffer;
      original_price: number;
      ticket_seq: number | null;
    }>(
      `SELECT status, owner_id, original_owner_id, totp_secret_encrypted,
              totp_secret_iv, original_price, ticket_seq
         FROM tickets.tickets WHERE order_id = $1`,
      [f.orderId],
    );
    expect(t.rows).toHaveLength(1);
    const row = t.rows[0];
    expect(row.status).toBe('valid');
    expect(row.owner_id).toBe(f.userId);
    expect(row.original_owner_id).toBe(f.userId);
    // Tohle je jádro věci: crypto sloupce vyplnil issuer, ne seed.
    expect(Buffer.isBuffer(row.totp_secret_encrypted)).toBe(true);
    expect(row.totp_secret_encrypted.length).toBeGreaterThan(0);
    // issuer ukládá celý bundle do `encrypted` a `iv` nechává ZÁMĚRNĚ prázdné
    expect(row.totp_secret_iv.length).toBe(0);
    expect(row.original_price).toBe(10000);
    // ticket_seq existuje jen s migrací 450 → důkaz, že klon migrace dostal
    expect(row.ticket_seq).not.toBeNull();
  });

  it('tickets() je idempotentní (advisory lock + UNIQUE z mig 450)', async () => {
    const c = await seed.chain();
    const o = await seed.order(c, { quantity: 2 });
    await seed.tickets(o.orderId);
    await seed.tickets(o.orderId); // druhé vydání nesmí zdvojit

    const n = await pool.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM tickets.tickets WHERE order_id = $1`,
      [o.orderId],
    );
    expect(Number(n.rows[0].n)).toBe(2);
  });
});
