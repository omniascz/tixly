// @vitest-environment node
/**
 * Regrese: sken u brány zůstal funkční PO opravách K1–K3/V1 (žádná z nich se
 * skeneru nedotýká). Ověřeno přímo proti handleru /api/admin/scanner/validate:
 * platná vstupenka → admitted, druhý sken → already_used.
 * Běží jen s FIX_E2E=1.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NextRequest } from 'next/server';
import type { Pool } from 'pg';
import { createLocalClone, hasLocalDb, type LocalClone } from './helpers/local-fixture';

const run = describe.skipIf(!hasLocalDb);
function post(path: string, body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new Request(`http://localhost${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

run('regrese: sken u brány (izolovaná DB)', () => {
  let clone: LocalClone;
  let pool: Pool;
  let scanPOST: (r: NextRequest) => Promise<Response>;

  beforeAll(async () => {
    clone = await createLocalClone();
    pool = clone.pool;
    scanPOST = (await import('@/app/api/admin/scanner/validate/route')).POST;
  }, 120_000);
  afterAll(async () => { await clone?.cleanup(); }, 30_000);

  it('platná vstupenka → admitted; druhý sken → already_used', async () => {
    const fc = await clone.seed.fullChain({ totalQty: 10, remainingQty: 9, basePrice: 30000 });
    const ticketId = (await pool.query<{ id: string }>(`SELECT id FROM tickets.tickets WHERE order_id=$1 LIMIT 1`, [fc.orderId])).rows[0].id;
    const hdr = { 'x-user-id': fc.adminUserId };

    const s1 = await scanPOST(post('/api/admin/scanner/validate', { ticketId }, hdr));
    const j1 = await s1.json();
    expect(s1.status, JSON.stringify(j1)).toBe(200);
    expect(j1.result, 'první sken admitted').toBe('admitted');

    const s2 = await scanPOST(post('/api/admin/scanner/validate', { ticketId }, hdr));
    const j2 = await s2.json();
    expect(j2.result, 'druhý sken už ne-admitted').not.toBe('admitted');
    const st = (await pool.query<{ s: string }>(`SELECT status s FROM tickets.tickets WHERE id=$1`, [ticketId])).rows[0].s;
    expect(st, 'vstupenka použitá').toBe('used');
  });
});
