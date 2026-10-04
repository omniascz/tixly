// @vitest-environment node
/**
 * Kolo 7 / krok 3 — výplaty pořadatelům, poctivý stav (C-57).
 * Dřív: CZK výplata „přes FIO" jen zapsala `processing` a executor hlásil `paid`, i když peníze neodešly;
 * `paid` šlo zapsat bez jakéhokoli potvrzení; přehled pořadatele si dopočítal minulá období jako „Vyplaceno".
 *
 * Očekávané:
 *   - ruční CZK převod → stav awaiting_manual_transfer, výsledek executoru není `paid`;
 *   - do `paid` jen po potvrzení platform adminem s datem a referencí (POST …/confirm-transfer), audit log;
 *     ne-admin 403, bez reference 400; přímý zápis `paid` bez potvrzení odmítne DB;
 *   - migrace převede neověřené `paid` na awaiting_manual_transfer (a je idempotentní);
 *   - přehled pořadatele neukazuje dopočítaná období jako vyplacená.
 */
import { readFileSync } from 'fs';
import path from 'path';
import type { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLocalClone, hasLocalDb, type LocalClone } from './helpers/local-fixture';
import { throughMiddleware } from './helpers/through-middleware';

const run = describe.skipIf(!hasLocalDb);
type H = (r: NextRequest, ctx: unknown) => Promise<Response>;
const MIG = path.resolve(__dirname, '../../migrations/497_payouts_manual_transfer.sql');

run('Kolo 7 — výplaty: paid jen po potvrzení převodu', () => {
  let clone: LocalClone;
  let adminTok: string;
  let adminId: string;

  const tokenFor = async (userId: string, memberships: unknown[] = [], isPlatformAdmin = false) => {
    const { signAccessToken } = await import('@/lib/auth');
    const email = (await clone.pool.query(`SELECT email FROM identity.users WHERE id=$1`, [userId])).rows[0].email;
    return signAccessToken({ id: userId, email, name: 'U' } as never, { isPlatformAdmin, promoterMemberships: memberships } as never);
  };
  const ownerTok = (c: { adminUserId: string; promoterId: string }) =>
    tokenFor(c.adminUserId, [{ promoterId: c.promoterId, slug: 'x', name: 'x', status: 'active', role: 'owner' }]);
  const confirm = async (id: string, body: unknown, tok: string) => {
    const m = await import('@/app/api/platform/admin/payouts/[id]/confirm-transfer/route');
    return throughMiddleware(new Request(`http://localhost/api/platform/admin/payouts/${id}/confirm-transfer`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://localhost', authorization: `Bearer ${tok}` },
      body: JSON.stringify(body),
    }), m.POST as unknown as H, { params: { id } });
  };

  async function payout(promoterId: string, status = 'pending') {
    return (await clone.pool.query<{ id: string }>(
      `INSERT INTO platform.payouts (promoter_id, period_from, period_to, gross_revenue, platform_fees, net_payout, status, payout_cycle, currency)
       VALUES ($1, now() - interval '30 days', now() - interval '1 day', 100000, 2500, 97500, $2, 'monthly', 'CZK') RETURNING id`,
      [promoterId, status])).rows[0].id;
  }
  const row = async (id: string) => (await clone.pool.query(
    `SELECT status, bank_reference, transfer_date::text AS paid_on, transfer_confirmed_by FROM platform.payouts WHERE id=$1`, [id])).rows[0];

  beforeAll(async () => {
    clone = await createLocalClone();
    const a = await clone.seed.user('padm3', 'Admin');
    adminId = a.id;
    await clone.pool.query(`UPDATE identity.users SET is_platform_admin = TRUE WHERE id=$1`, [a.id]);
    adminTok = await tokenFor(a.id, [], true);
  }, 180_000);
  afterAll(async () => { await clone?.cleanup(); }, 60_000);

  it('ruční CZK převod: executor zapíše awaiting_manual_transfer a nehlásí paid', async () => {
    const c = await clone.seed.chain();
    await clone.pool.query(`UPDATE platform.promoters SET iban='CZ6508000000192000145399', primary_currency='CZK', payout_method='bank_transfer' WHERE id=$1`, [c.promoterId]);
    const id = await payout(c.promoterId);
    const { executePayout } = await import('@/lib/payouts/executor');
    const r = await executePayout({
      payout_id: id, promoter_id: c.promoterId, net_payout: 97500, currency: 'CZK', retry_count: 0,
      promoter_name: 'P', iban: 'CZ6508000000192000145399', swift_bic: null, payout_method: 'bank_transfer', payout_currency: 'CZK',
    });
    expect(r.status).not.toBe('paid');
    expect(r.status).toBe('awaiting_manual_transfer');
    expect((await row(id)).status).toBe('awaiting_manual_transfer');
  });

  it('potvrzení převodu: ne-admin 403, bez reference 400, s datem a referencí paid + audit', async () => {
    const c = await clone.seed.chain();
    const id = await payout(c.promoterId, 'awaiting_manual_transfer');
    expect((await confirm(id, { transferDate: '2026-10-01', bankReference: 'VS123' }, await ownerTok(c))).status).toBe(403);
    const noRef = await confirm(id, { transferDate: '2026-10-01' }, adminTok);
    expect(noRef.status).toBe(400);
    expect((await confirm(id, { transferDate: '2026-10-01', bankReference: '  ' }, adminTok)).status).toBe(400);
    expect((await confirm(id, { bankReference: 'VS123' }, adminTok)).status).toBe(400);
    expect((await row(id)).status).toBe('awaiting_manual_transfer');

    const ok = await confirm(id, { transferDate: '2026-10-01', bankReference: 'FIO-2026-10-01-VS123' }, adminTok);
    expect(ok.status, await ok.clone().text()).toBe(200);
    expect(await row(id)).toMatchObject({ status: 'paid', bank_reference: 'FIO-2026-10-01-VS123', paid_on: '2026-10-01', transfer_confirmed_by: adminId });
    const audit = (await clone.pool.query(
      `SELECT actor_user_id, metadata FROM audit.platform_log WHERE action='payout.transfer_confirmed' AND target_id=$1`, [id])).rows;
    expect(audit).toHaveLength(1);
    expect(audit[0].actor_user_id).toBe(adminId);
    expect(audit[0].metadata).toMatchObject({ bankReference: 'FIO-2026-10-01-VS123', transferDate: '2026-10-01', fromStatus: 'awaiting_manual_transfer' });

    // znovu potvrdit už vyplacenou → 409, nic se nepřepíše
    expect((await confirm(id, { transferDate: '2026-10-02', bankReference: 'JINA' }, adminTok)).status).toBe(409);
    expect((await row(id)).bank_reference).toBe('FIO-2026-10-01-VS123');
  });

  it('DB odmítne zápis paid bez potvrzení (i pod tixly_app v servisním kontextu)', async () => {
    const c = await clone.seed.chain();
    const id = await payout(c.promoterId, 'processing');
    const { db, runWithServiceContext } = await import('@/lib/db/rls-pool');
    await expect(runWithServiceContext(() =>
      db().query(`UPDATE platform.payouts SET status='paid', paid_at=now() WHERE id=$1`, [id]))).rejects.toThrow(/PAYOUT_PAID_REQUIRES_CONFIRMATION/);
    await expect(clone.pool.query(`UPDATE platform.payouts SET status='paid', bank_reference='X' WHERE id=$1`, [id]))
      .rejects.toThrow(/PAYOUT_PAID_REQUIRES_CONFIRMATION/);
    // potvrzení bankou (Wise webhook) je ověřené
    await clone.pool.query(`UPDATE platform.payouts SET payout_provider='wise', external_payout_id='777' WHERE id=$1`, [id]);
    await clone.pool.query(`UPDATE platform.payouts SET status='paid', provider_confirmed_at=now() WHERE id=$1`, [id]);
    expect((await row(id)).status).toBe('paid');
  });

  it('migrace převede neověřené paid na awaiting_manual_transfer a je idempotentní', async () => {
    const c = await clone.seed.chain();
    const id = await payout(c.promoterId);
    // simulace historického stavu: paid zapsané bez potvrzení (před migrací)
    await clone.pool.query(`ALTER TABLE platform.payouts DISABLE TRIGGER trg_payouts_paid_guard`);
    try {
      await clone.pool.query(`UPDATE platform.payouts SET status='paid', paid_at=now() WHERE id=$1`, [id]);
    } finally {
      await clone.pool.query(`ALTER TABLE platform.payouts ENABLE TRIGGER trg_payouts_paid_guard`);
    }
    const sql = readFileSync(MIG, 'utf8');
    await clone.pool.query(sql);
    await clone.pool.query(sql);
    expect((await row(id)).status).toBe('awaiting_manual_transfer');
    const audit = (await clone.pool.query(`SELECT count(*)::int n FROM audit.platform_log WHERE action='payout.unverified_paid_reverted' AND target_id=$1`, [id])).rows[0].n;
    expect(audit).toBe(1);
  });

  it('přehled pořadatele: dopočítaná období nejsou „paid", stav ruční převod je vidět', async () => {
    const c = await clone.seed.chain();
    await clone.seed.order(c, { quantity: 1, unitPrice: 50000, status: 'paid' });
    const { GET } = await import('@/app/api/admin/payouts/route');
    const get = async () => {
      const r = await throughMiddleware(new Request('http://localhost/api/admin/payouts', { headers: { authorization: `Bearer ${await ownerTok(c)}` } }),
        GET as unknown as H, {});
      return (await r.json()) as { source: string; payouts: { id: string; status: string }[] };
    };
    const est = await get();
    expect(est.source).toBe('computed');
    expect(est.payouts.length).toBeGreaterThan(0);
    for (const p of est.payouts) {
      expect(p.status).toBe('estimate');
      expect(p.id).not.toMatch(/^mock-/);
    }
    await payout(c.promoterId, 'awaiting_manual_transfer');
    const real = await get();
    expect(real.source).toBe('real');
    expect(real.payouts.map((p) => p.status)).toEqual(['awaiting_manual_transfer']);
    // stránka si nesmí vyrábět „Vyplaceno" z objednávek
    const page = readFileSync(path.resolve(__dirname, '../src/app/admin/payouts/page.tsx'), 'utf8');
    expect(page).not.toMatch(/buildSyntheticPayouts|'paid'\s*,\s*\n?\s*paidAt:\s*key/);
  });
});
