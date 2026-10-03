// @vitest-environment node
/**
 * Kolo 3 / krok 2 — /api/my/* (upgrade, upgrade-options, převod lístku, …) nedostávalo
 * identitu: middleware nastavuje x-user-id z ověřeného JWT jen pro vyjmenované prefixy a
 * /api/my/ mezi nimi nebyl → routy vracely vždy 401 (upgrade kupce nefungoval).
 * Podvržené x-user-id se zahazuje dál.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NextRequest } from 'next/server';
import { createLocalClone, hasLocalDb, type LocalClone } from './helpers/local-fixture';
import { throughMiddleware } from './helpers/through-middleware';

const run = describe.skipIf(!hasLocalDb);
type H = (r: NextRequest, ctx: unknown) => Promise<Response>;

run('Krok 2 (kolo 3) — /api/my/* ověřuje Bearer JWT', () => {
  let clone: LocalClone;
  beforeAll(async () => { clone = await createLocalClone(); }, 120_000);
  afterAll(async () => { await clone?.cleanup(); }, 30_000);

  it('upgrade: vlastník s Bearer projde až na kontrolu vlastnictví (404 TICKET_NOT_FOUND); bez tokenu / podvržené x-user-id → 401', async () => {
    const fc = await clone.seed.fullChain();
    const email = (await clone.pool.query(`SELECT email FROM identity.users WHERE id=$1`, [fc.userId])).rows[0].email;
    const { signAccessToken } = await import('@/lib/auth');
    const t = await signAccessToken({ id: fc.userId, email, name: 'T' } as never, { isPlatformAdmin: false, promoterMemberships: [] });
    const { POST } = await import('@/app/api/my/orders/[id]/upgrade/route');
    const body = JSON.stringify({ ticketId: '00000000-0000-4000-8000-000000000000', newTicketTypeId: fc.ticketTypeId });
    const call = (h: Record<string, string>) => throughMiddleware(
      new Request(`http://localhost/api/my/orders/${fc.orderId}/upgrade`, { method: 'POST', headers: { 'content-type': 'application/json', ...h }, body }),
      POST as H, { params: { id: fc.orderId } });
    const own = await call({ authorization: `Bearer ${t}` });
    expect(own.status, await own.clone().text()).toBe(404);
    expect(((await own.json()) as { error: string }).error).toBe('TICKET_NOT_FOUND');
    expect((await call({})).status).toBe(401);
    expect((await call({ 'x-user-id': fc.userId })).status).toBe(401);
  });
});
