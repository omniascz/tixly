/**
 * RLS cross-tenant isolation test.
 *
 * Validuje že promotér A nevidí data promotéra B přes různé RLS-enabled tabulky.
 * Spouští SQL přímo přes pg connection jako `tixly_app` user (bez BYPASSRLS).
 *
 * Skipne se pokud DATABASE_URL je `tixly` user (RLS bypass v dev).
 *
 * Pre-requisites:
 *   - Migrace 285 + 286 aplikované
 *   - tixly_app role existuje
 *   - Alespoň 2 promotéři + 1 event per promoter v DB
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';

const APP_DATABASE_URL =
  process.env.DATABASE_URL_APP ??
  'postgresql://tixly_app:tixly_app_dev_pwd@localhost:5433/tixly';

const SUPER_DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://tixly:tixly_dev@localhost:5433/tixly';

let superPool: Pool;
let appPool: Pool;
let promoterA: string;
let promoterB: string;

beforeAll(async () => {
  superPool = new Pool({ connectionString: SUPER_DATABASE_URL });
  appPool = new Pool({ connectionString: APP_DATABASE_URL });

  // Najdi nebo vytvoř 2 promotéry pro test
  const existing = await superPool.query<{ id: string }>(
    `SELECT id FROM platform.promoters
      WHERE status = 'active'
      ORDER BY created_at
      LIMIT 2`,
  );

  if (existing.rows.length < 2) {
    throw new Error(
      'RLS isolation test vyžaduje alespoň 2 active promotéry v DB. ' +
        'Spustit npm run db:seed nebo vytvořit manuálně.',
    );
  }

  promoterA = existing.rows[0].id;
  promoterB = existing.rows[1].id;
});

afterAll(async () => {
  await superPool.end();
  await appPool.end();
});

describe('RLS cross-tenant isolation', () => {
  it('test setup: 2 promotéři dostupní', () => {
    expect(promoterA).toMatch(/^[0-9a-f-]{36}$/i);
    expect(promoterB).toMatch(/^[0-9a-f-]{36}$/i);
    expect(promoterA).not.toBe(promoterB);
  });

  it('tixly_app user NEMÁ BYPASSRLS', async () => {
    const r = await superPool.query<{ rolbypassrls: boolean }>(
      `SELECT rolbypassrls FROM pg_roles WHERE rolname = 'tixly_app'`,
    );
    expect(r.rows[0]?.rolbypassrls).toBe(false);
  });

  it('catalog.events: promotér A vidí SVÉ events', async () => {
    const client = await appPool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL app.current_promoter_id = '${promoterA}'`);
      const r = await client.query<{ promoter_id: string }>(
        `SELECT promoter_id FROM catalog.events WHERE status != 'published' LIMIT 50`,
      );
      // Vše musí patřit A (NULL by mohlo být u dev seed bez promoter_id, skip)
      const otherPromoter = r.rows.find(
        (row) => row.promoter_id !== null && row.promoter_id !== promoterA,
      );
      expect(otherPromoter).toBeUndefined();
      await client.query('COMMIT');
    } finally {
      client.release();
    }
  });

  it('catalog.events: promotér A NEVIDÍ unpublished events promotéra B', async () => {
    // Promotér B má alespoň 1 unpublished/draft event
    const client = await appPool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL app.current_promoter_id = '${promoterA}'`);
      const r = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM catalog.events
          WHERE promoter_id = $1 AND status != 'published'`,
        [promoterB],
      );
      expect(Number(r.rows[0].count)).toBe(0);
      await client.query('COMMIT');
    } finally {
      client.release();
    }
  });

  it('catalog.events: bez context vidí jen status=published', async () => {
    const client = await appPool.connect();
    try {
      const r = await client.query<{ status: string }>(
        `SELECT DISTINCT status FROM catalog.events LIMIT 10`,
      );
      // Bez session vars: RLS policy `OR status = 'published'` → jen published
      const nonPublished = r.rows.find((row) => row.status !== 'published');
      expect(nonPublished).toBeUndefined();
    } finally {
      client.release();
    }
  });

  it('platform admin context vidí všechny events napříč promotéry', async () => {
    const client = await appPool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL app.is_platform_admin = 'true'`);
      const r = await client.query<{ count: string }>(
        `SELECT COUNT(DISTINCT promoter_id)::text AS count FROM catalog.events
          WHERE promoter_id IS NOT NULL`,
      );
      // Alespoň 2 různí promotéři viditelní
      expect(Number(r.rows[0].count)).toBeGreaterThanOrEqual(2);
      await client.query('COMMIT');
    } finally {
      client.release();
    }
  });

  it('marketing.gift_vouchers: B vidí jen své vouchery', async () => {
    // Insert test vouchers jako superuser
    await superPool.query(
      `INSERT INTO marketing.gift_vouchers
         (code, promoter_id, amount_halire, balance_halire)
       VALUES ($1, $2, 10000, 10000)
       ON CONFLICT DO NOTHING`,
      [`TEST-A-${Date.now()}`, promoterA],
    );
    await superPool.query(
      `INSERT INTO marketing.gift_vouchers
         (code, promoter_id, amount_halire, balance_halire)
       VALUES ($1, $2, 10000, 10000)
       ON CONFLICT DO NOTHING`,
      [`TEST-B-${Date.now()}`, promoterB],
    );

    const client = await appPool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL app.current_promoter_id = '${promoterB}'`);
      const r = await client.query<{ promoter_id: string }>(
        `SELECT promoter_id FROM marketing.gift_vouchers LIMIT 50`,
      );
      const leakage = r.rows.find((row) => row.promoter_id !== promoterB);
      expect(leakage).toBeUndefined();
      await client.query('COMMIT');
    } finally {
      client.release();
    }
  });

  it('orders.invoices: A nevidí faktury B', async () => {
    const client = await appPool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL app.current_promoter_id = '${promoterA}'`);
      const r = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM orders.invoices WHERE promoter_id = $1`,
        [promoterB],
      );
      expect(Number(r.rows[0].count)).toBe(0);
      await client.query('COMMIT');
    } finally {
      client.release();
    }
  });

  it('b2b.api_keys: A nevidí API keys B', async () => {
    const client = await appPool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL app.current_promoter_id = '${promoterA}'`);
      const r = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM b2b.api_keys WHERE promoter_id = $1`,
        [promoterB],
      );
      expect(Number(r.rows[0].count)).toBe(0);
      await client.query('COMMIT');
    } finally {
      client.release();
    }
  });
});
