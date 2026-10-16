// @vitest-environment node
/**
 * Kolo 4 / krok 3c — veřejné API vracelo kontakty soukromých osob, které je nikde
 * neoznačily jako veřejné (FIX_REPORT_R3 bod 4 + průchod všemi veřejnými routami):
 *  - GET /api/group-invitations/[token]: e-mail a userId organizátora skupiny;
 *  - GET /api/transfer/accept/[token]: e-mail odesílatele převodu;
 *  - GET /api/gift/[token]: `fromName = COALESCE(name, email)` → e-mail dárce, když nemá jméno.
 * Očekávané: jen jméno (nebo nic); žádný e-mail ani interní ID osoby v odpovědi.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomBytes } from 'crypto';
import type { NextRequest } from 'next/server';
import { createLocalClone, hasLocalDb, type LocalClone } from './helpers/local-fixture';
import { throughMiddleware } from './helpers/through-middleware';

const run = describe.skipIf(!hasLocalDb);
type H = (r: NextRequest, ctx: unknown) => Promise<Response>;

run('Krok 3c (kolo 4) — veřejné odpovědi bez soukromých kontaktů', () => {
  let clone: LocalClone;
  let fc: Awaited<ReturnType<LocalClone['seed']['fullChain']>>;
  let ownerEmail: string;

  beforeAll(async () => {
    clone = await createLocalClone();
    fc = await clone.seed.fullChain();
    ownerEmail = (await clone.pool.query(`SELECT email FROM identity.users WHERE id=$1`, [fc.userId])).rows[0].email;
  }, 180_000);
  afterAll(async () => { await clone?.cleanup(); }, 30_000);

  const get = async (url: string, mod: string, params: unknown) => {
    const m = (await import(/* @vite-ignore */ mod)) as unknown as Record<string, H>;
    const r = await throughMiddleware(new Request(`http://localhost${url}`), m.GET, { params });
    return { status: r.status, body: await r.text() };
  };

  it('pozvánka do skupiny: bez e-mailu a ID organizátora', async () => {
    const token = randomBytes(16).toString('hex');
    await clone.pool.query(
      `INSERT INTO orders.group_invitations (organizer_user_id, event_id, ticket_type_id, target_seats, invite_token, status, expires_at)
       VALUES ($1,$2,$3,4,$4,'open',now()+interval '1 day')`, [fc.userId, fc.eventId, fc.ticketTypeId, token]);
    const r = await get(`/api/group-invitations/${token}`, '@/app/api/group-invitations/[token]/route', { token });
    expect(r.status, r.body).toBe(200);
    expect(r.body).not.toContain(ownerEmail);
    expect(r.body).not.toContain(fc.userId);
  });

  it('náhled převodu: bez e-mailu odesílatele', async () => {
    const tkt = (await clone.pool.query(`SELECT id FROM tickets.tickets WHERE order_id=$1 LIMIT 1`, [fc.orderId])).rows[0].id;
    const token = randomBytes(16).toString('hex');
    await clone.pool.query(
      `INSERT INTO tickets.transfer_invitations (ticket_id, from_user_id, to_email, invite_token, status, expires_at)
       VALUES ($1,$2,'prijemce@tixly.test',$3,'pending',now()+interval '1 day')`, [tkt, fc.userId, token]);
    const r = await get(`/api/transfer/accept/${token}`, '@/app/api/transfer/accept/[token]/route', { token });
    expect(r.status, r.body).toBe(200);
    expect(r.body).not.toContain(ownerEmail);
  });

  it('dárek: dárce bez jména neprozradí e-mail', async () => {
    await clone.pool.query(`UPDATE identity.users SET name = NULL, first_name = NULL, last_name = NULL WHERE id=$1`, [fc.userId]);
    const token = randomBytes(16).toString('hex');
    await clone.pool.query(
      `INSERT INTO orders.gift_claims (order_id, claim_token, recipient_email, recipient_name, event_id, ticket_type_id, expires_at)
       VALUES ($1,$2,'obdarovany@tixly.test','Obdarovaný',$3,$4,now()+interval '1 day')`, [fc.orderId, token, fc.eventId, fc.ticketTypeId]);
    const r = await get(`/api/gift/${token}`, '@/app/api/gift/[token]/route', { token });
    expect(r.status, r.body).toBe(200);
    expect(r.body).not.toContain(ownerEmail);
  });
});
