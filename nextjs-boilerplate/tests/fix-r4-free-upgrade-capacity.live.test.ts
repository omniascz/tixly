// @vitest-environment node
/**
 * Kolo 4 / krok 3f — bezplatný upgrade (POST /api/my/orders/[id]/upgrade, cílový typ ne
 * dražší než zaplacená cena) změnil typ vstupenky, ale NE kapacitu typů (FIX_REPORT_R3 bod 4):
 * cílový typ se neodečetl a zdrojový nevrátil → cílový šlo „přeprodat", zdrojový nedoprodat.
 * Očekávané: cílový typ −1, zdrojový +1; vstupenka má cílový typ.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NextRequest } from 'next/server';
import { createLocalClone, hasLocalDb, type LocalClone } from './helpers/local-fixture';
import { throughMiddleware } from './helpers/through-middleware';

const run = describe.skipIf(!hasLocalDb);
type H = (r: NextRequest, ctx: unknown) => Promise<Response>;

run('Krok 3f (kolo 4) — bezplatný upgrade přesune kapacitu', () => {
  let clone: LocalClone;
  let fc: Awaited<ReturnType<LocalClone['seed']['fullChain']>>;
  let target: string;
  let tok: string;
  let ticketId: string;

  beforeAll(async () => {
    clone = await createLocalClone();
    fc = await clone.seed.fullChain({ basePrice: 10000, totalQty: 10, remainingQty: 9 });
    target = (await clone.pool.query<{ id: string }>(
      `INSERT INTO catalog.ticket_types (event_id, name, kind, base_price, total_qty, remaining_qty, visibility)
       VALUES ($1,'Balkon','standing',10000,5,5,'public') RETURNING id`, [fc.eventId])).rows[0].id;
    ticketId = (await clone.pool.query(`SELECT id FROM tickets.tickets WHERE order_id=$1 LIMIT 1`, [fc.orderId])).rows[0].id;
    const email = (await clone.pool.query(`SELECT email FROM identity.users WHERE id=$1`, [fc.userId])).rows[0].email;
    const { signAccessToken } = await import('@/lib/auth');
    tok = await signAccessToken({ id: fc.userId, email, name: 'U' } as never, { isPlatformAdmin: false, promoterMemberships: [] } as never);
  }, 180_000);
  afterAll(async () => { await clone?.cleanup(); }, 30_000);

  const rem = async (id: string) => (await clone.pool.query(`SELECT remaining_qty FROM catalog.ticket_types WHERE id=$1`, [id])).rows[0].remaining_qty as number;

  it('cílový −1, zdrojový +1', async () => {
    const srcBefore = await rem(fc.ticketTypeId);
    const tgtBefore = await rem(target);
    const { POST } = await import('@/app/api/my/orders/[id]/upgrade/route');
    const r = await throughMiddleware(new Request(`http://localhost/api/my/orders/${fc.orderId}/upgrade`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${tok}` },
      body: JSON.stringify({ ticketId, newTicketTypeId: target }),
    }), POST as unknown as H, { params: { id: fc.orderId } });
    const body = await r.text();
    expect(r.status, body).toBe(200);
    expect(JSON.parse(body)).toMatchObject({ applied: true, upgradeFeeHalire: 0 });
    expect((await clone.pool.query(`SELECT ticket_type_id FROM tickets.tickets WHERE id=$1`, [ticketId])).rows[0].ticket_type_id).toBe(target);
    expect({ tgt: await rem(target), src: await rem(fc.ticketTypeId) }).toEqual({ tgt: tgtBefore - 1, src: srcBefore + 1 });
  });
});
