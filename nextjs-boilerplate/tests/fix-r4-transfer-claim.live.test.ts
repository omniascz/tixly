// @vitest-environment node
/**
 * Kolo 4 / krok 3 — převzetí převodu vstupenky (POST /api/tickets/transfer/[token]) pod
 * tixly_app vstupenku NEPŘEVEDLO: UPDATE tickets.tickets běžel v kontextu PŘÍJEMCE, který
 * cizí vstupenku pod RLS nevidí → 0 řádků bez chyby, ale převod se přesto označil
 * 'claimed' a routa vrátila 200 {claimed:true}. Příjemce vstupenku neměl, odesílatel ano.
 * (Odhaleno regresním testem kroku 3b.)
 *
 * Očekávané: po převzetí je vlastníkem příjemce; když se vlastnictví změnit nepodaří
 * (vstupenka mezitím změnila majitele), převod zůstane 'pending' a routa vrátí chybu.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NextRequest } from 'next/server';
import { createLocalClone, hasLocalDb, type LocalClone } from './helpers/local-fixture';
import { throughMiddleware } from './helpers/through-middleware';

const run = describe.skipIf(!hasLocalDb);
type H = (r: NextRequest, ctx: unknown) => Promise<Response>;

run('Krok 3 (kolo 4) — převzetí převodu vstupenky změní vlastníka', () => {
  let clone: LocalClone;
  let tok: (u: { id: string; email: string }) => Promise<string>;
  beforeAll(async () => {
    clone = await createLocalClone();
    const { signAccessToken } = await import('@/lib/auth');
    tok = (u) => signAccessToken({ id: u.id, email: u.email, name: 'T' } as never, { isPlatformAdmin: false, promoterMemberships: [] } as never);
  }, 120_000);
  afterAll(async () => { await clone?.cleanup(); }, 30_000);

  it('odeslání odesílatelem, převzetí příjemcem → vlastníkem je příjemce', async () => {
    const fc = await clone.seed.fullChain();
    const sender = { id: fc.userId, email: (await clone.pool.query(`SELECT email FROM identity.users WHERE id=$1`, [fc.userId])).rows[0].email };
    const recipient = await clone.seed.user('prijemce');
    const tkt = (await clone.pool.query(`SELECT id FROM tickets.tickets WHERE order_id=$1 LIMIT 1`, [fc.orderId])).rows[0].id;
    const start = (await import('@/app/api/my/tickets/[ticketId]/transfer/route')) as unknown as Record<string, H>;
    const s = await throughMiddleware(new Request(`http://localhost/api/my/tickets/${tkt}/transfer`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${await tok(sender)}` },
      body: JSON.stringify({ toEmail: recipient.email, toName: 'Příjemce' }),
    }), start.POST, { params: { ticketId: tkt } });
    expect(s.status, await s.clone().text()).toBeLessThan(300);
    const tr = (await clone.pool.query<{ transfer_token: string }>(`SELECT transfer_token FROM orders.ticket_transfers WHERE ticket_id=$1 AND status='pending' ORDER BY created_at DESC LIMIT 1`, [tkt])).rows[0];
    expect(tr, 'převod založen').toBeTruthy();
    const claim = (await import('@/app/api/tickets/transfer/[token]/route')) as unknown as Record<string, H>;
    const c = await throughMiddleware(new Request(`http://localhost/api/tickets/transfer/${tr.transfer_token}`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${await tok(recipient)}` }, body: '{}',
    }), claim.POST, { params: { token: tr.transfer_token } });
    expect(c.status, await c.clone().text()).toBe(200);
    expect((await clone.pool.query(`SELECT owner_id FROM tickets.tickets WHERE id=$1`, [tkt])).rows[0].owner_id).toBe(recipient.id);
  });

  it('vstupenka mezitím změnila majitele → převod zůstane pending, routa chybu (ne tiché claimed)', async () => {
    const fc = await clone.seed.fullChain();
    const recipient = await clone.seed.user('prijemce2');
    const third = await clone.seed.user('treti');
    const tkt = (await clone.pool.query(`SELECT id FROM tickets.tickets WHERE order_id=$1 LIMIT 1`, [fc.orderId])).rows[0].id;
    const token = `tt-race-${Date.now()}`;
    await clone.pool.query(
      `INSERT INTO orders.ticket_transfers (ticket_id, order_id, from_user_id, to_email, transfer_token, status, expires_at)
       VALUES ($1,$2,$3,$4,$5,'pending',now()+interval '1 day')`, [tkt, fc.orderId, fc.userId, recipient.email, token]);
    await clone.pool.query(`UPDATE tickets.tickets SET owner_id=$2 WHERE id=$1`, [tkt, third.id]);
    const claim = (await import('@/app/api/tickets/transfer/[token]/route')) as unknown as Record<string, H>;
    const c = await throughMiddleware(new Request(`http://localhost/api/tickets/transfer/${token}`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${await tok(recipient)}` }, body: '{}',
    }), claim.POST, { params: { token } });
    expect(c.status, await c.clone().text()).toBeGreaterThanOrEqual(400);
    expect((await clone.pool.query(`SELECT status FROM orders.ticket_transfers WHERE transfer_token=$1`, [token])).rows[0].status).toBe('pending');
    expect((await clone.pool.query(`SELECT owner_id FROM tickets.tickets WHERE id=$1`, [tkt])).rows[0].owner_id).toBe(third.id);
  });
});
