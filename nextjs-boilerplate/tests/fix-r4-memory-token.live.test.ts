// @vitest-environment node
/**
 * Kolo 4 / krok 2 — GET /api/tickets/[id]/memory (pamětní vstupenka) pouštěl každého,
 * kdo poslal `?token=` s JAKOUKOLI hodnotou (`hasQueryToken = !!queryToken`) — token se
 * nikde neověřoval ani nevydával. Vrátil stav vstupenky, čas odbavení, sedadlo a akci.
 *
 * Očekávané: vlastník (JWT) 200; host s podepsaným tokenem TÉTO vstupenky (HMAC, stejný jako
 * SMS odkaz /t/{token}) 200; libovolný / cizí token → 401; cizí přihlášený → 404; anonym 401.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NextRequest } from 'next/server';
import { createLocalClone, hasLocalDb, type LocalClone } from './helpers/local-fixture';
import { throughMiddleware } from './helpers/through-middleware';

const run = describe.skipIf(!hasLocalDb);
type H = (r: NextRequest, ctx: unknown) => Promise<Response>;

run('Krok 2 (kolo 4) — pamětní vstupenka jen vlastníkovi nebo s podepsaným tokenem', () => {
  let clone: LocalClone;
  let ticketId: string;
  let otherTicketId: string;
  let ownerTok: string;
  let otherTok: string;

  beforeAll(async () => {
    clone = await createLocalClone();
    const fc = await clone.seed.fullChain();
    const fc2 = await clone.seed.fullChain();
    ticketId = (await clone.pool.query(`SELECT id FROM tickets.tickets WHERE order_id=$1 LIMIT 1`, [fc.orderId])).rows[0].id;
    otherTicketId = (await clone.pool.query(`SELECT id FROM tickets.tickets WHERE order_id=$1 LIMIT 1`, [fc2.orderId])).rows[0].id;
    const { signAccessToken } = await import('@/lib/auth');
    const t = async (id: string) => {
      const email = (await clone.pool.query(`SELECT email FROM identity.users WHERE id=$1`, [id])).rows[0].email;
      return signAccessToken({ id, email, name: 'M' } as never, { isPlatformAdmin: false, promoterMemberships: [] } as never);
    };
    ownerTok = await t(fc.userId);
    otherTok = await t(fc2.userId);
  }, 180_000);
  afterAll(async () => { await clone?.cleanup(); }, 30_000);

  const get = async (q = '', h: Record<string, string> = {}) => {
    const { GET } = await import('@/app/api/tickets/[id]/memory/route');
    return throughMiddleware(new Request(`http://localhost/api/tickets/${ticketId}/memory${q}`, { headers: h }),
      GET as unknown as H, { params: Promise.resolve({ id: ticketId }) });
  };

  it('libovolný token a token jiné vstupenky → 401 bez dat', async () => {
    const { issueTicketMagicToken } = await import('@/lib/tickets/magic-token');
    for (const q of ['?token=x', `?token=${issueTicketMagicToken(otherTicketId)}`]) {
      const r = await get(q);
      const body = await r.text();
      expect(r.status, `${q}: ${body}`).toBe(401);
      expect(body).not.toContain(ticketId);
    }
    expect((await get()).status).toBe(401);
  });

  it('podepsaný token této vstupenky 200; vlastník 200; cizí přihlášený 404', async () => {
    const { issueTicketMagicToken } = await import('@/lib/tickets/magic-token');
    const g = await get(`?token=${issueTicketMagicToken(ticketId)}`);
    expect(g.status, await g.clone().text()).toBe(200);
    expect((await get('', { authorization: `Bearer ${ownerTok}` })).status).toBe(200);
    const other = await get('', { authorization: `Bearer ${otherTok}` });
    expect(other.status).toBe(404);
    expect(await other.text()).not.toContain(ticketId);
  });

  it('e-mail s pamětní vstupenkou nese podepsaný token', async () => {
    const { readFileSync } = await import('fs');
    const src = readFileSync('src/app/api/admin/commemorative/send/route.ts', 'utf8');
    expect(src).toMatch(/memory\?token=\$\{[^}]*issueTicketMagicToken/);
  });
});
