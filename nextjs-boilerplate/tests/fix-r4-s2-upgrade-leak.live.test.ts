// @vitest-environment node
/**
 * Kolo 4 / krok 1 — S2: GET /api/buyer/tickets/[ticketId]/upgrade vracel stav, typ a cenu
 * vstupenky komukoli, kdo znal UUID (audit 08 I1: cizí pořadatel, cizí kupec i anonym 200).
 * Routa běžela v servisním kontextu a vlastnictví neověřovala vůbec.
 *
 * Očekávané chování: vlastník (ověřený přes middleware) 200; cizí kupec / cizí pořadatel → 404
 * a v odpovědi nic o vstupence (ani id); nepřihlášený → 401. Totéž pro POST (vypnutá demo
 * cesta nesmí prozrazovat existenci cizí vstupenky přes 403 NOT_OWNER).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NextRequest } from 'next/server';
import { createLocalClone, hasLocalDb, type LocalClone } from './helpers/local-fixture';
import { throughMiddleware } from './helpers/through-middleware';

const run = describe.skipIf(!hasLocalDb);
type H = (r: NextRequest, ctx: unknown) => Promise<Response>;

run('Krok 1 (kolo 4) — S2 upgrade únik', () => {
  let clone: LocalClone;
  let ticketId: string;
  let ownerTok: string;
  let otherBuyerTok: string;
  let otherPromoterTok: string;

  beforeAll(async () => {
    clone = await createLocalClone();
    const { signAccessToken } = await import('@/lib/auth');
    const fc = await clone.seed.fullChain();
    ticketId = (await clone.pool.query(`SELECT id FROM tickets.tickets WHERE order_id=$1 LIMIT 1`, [fc.orderId])).rows[0].id;
    const tok = async (id: string, promoterId?: string) => {
      const email = (await clone.pool.query(`SELECT email FROM identity.users WHERE id=$1`, [id])).rows[0].email;
      return signAccessToken({ id, email, name: 'T' } as never, {
        isPlatformAdmin: false,
        promoterMemberships: promoterId ? [{ promoterId, slug: 'x', name: 'x', status: 'active', role: 'owner' }] : [],
      } as never);
    };
    ownerTok = await tok(fc.userId);
    const other = await clone.seed.user('cizi');
    otherBuyerTok = await tok(other.id);
    const otherChain = await clone.seed.chain();
    otherPromoterTok = await tok(otherChain.adminUserId, otherChain.promoterId);
  }, 180_000);
  afterAll(async () => { await clone?.cleanup(); }, 30_000);

  const get = async (h: Record<string, string>) => {
    const { GET } = await import('@/app/api/buyer/tickets/[ticketId]/upgrade/route');
    return throughMiddleware(new Request(`http://localhost/api/buyer/tickets/${ticketId}/upgrade`, { headers: h }),
      GET as H, { params: { ticketId } });
  };

  it('vlastník 200 s vlastní vstupenkou', async () => {
    const r = await get({ authorization: `Bearer ${ownerTok}` });
    const body = await r.text();
    expect(r.status, body).toBe(200);
    expect(body).toContain(ticketId);
  });

  it('cizí kupec a cizí pořadatel → 404 bez dat; anonym → 401 bez dat', async () => {
    for (const [who, h, want] of [
      ['cizí kupec', { authorization: `Bearer ${otherBuyerTok}` }, 404],
      ['cizí pořadatel', { authorization: `Bearer ${otherPromoterTok}` }, 404],
      ['anonym', {}, 401],
    ] as const) {
      const r = await get(h);
      const body = await r.text();
      expect(r.status, `${who}: ${body}`).toBe(want);
      expect(body, who).not.toContain(ticketId);
      expect(body, who).not.toMatch(/ticketTypeId|pricePaidHalire|currentTicket/);
    }
  });

  it('POST: cizí kupec nedostane 403 NOT_OWNER (prozrazení existence), ale 404/410 bez dat', async () => {
    const { POST } = await import('@/app/api/buyer/tickets/[ticketId]/upgrade/route');
    const r = await throughMiddleware(new Request(`http://localhost/api/buyer/tickets/${ticketId}/upgrade`, {
      method: 'POST',
      headers: { authorization: `Bearer ${otherBuyerTok}`, 'content-type': 'application/json', origin: 'http://localhost' },
      body: JSON.stringify({ targetTicketTypeId: '00000000-0000-4000-8000-000000000000' }),
    }), POST as H, { params: { ticketId } });
    const body = await r.text();
    expect(body).not.toContain('NOT_OWNER');
    expect(body).not.toContain(ticketId);
  });
});
