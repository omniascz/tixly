// @vitest-environment node
/**
 * Kolo 4 / krok 1 — 5xx z IDOR sweepu (audit 08 I2).
 *
 * calendar.ics: `pg` vrací timestamptz jako Date, route volala `iso.replace` na Date → 500
 * pro KAŽDÉHO volajícího (i vlastníka). Neplatné UUID šlo rovnou do SQL (22P02 → 500).
 * kiosk: dotaz četl neexistující sloupce ticket_types (capacity, is_active, sort_order) → 500 vždy.
 *
 * Očekávané: platný vstup 200; neplatné ID / cizí přihlášený / nepublikovaná akce → 4xx.
 * calendar.ics zůstává capability pro hosta (orderId = UUID, jako stránka potvrzení objednávky),
 * ale odpověď nesmí vracet ID objednávky (UID je odvozené, ne samotné ID).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NextRequest } from 'next/server';
import { createLocalClone, hasLocalDb, type LocalClone } from './helpers/local-fixture';
import { throughMiddleware } from './helpers/through-middleware';

const run = describe.skipIf(!hasLocalDb);
type H = (r: NextRequest, ctx: unknown) => Promise<Response>;

run('Krok 1 (kolo 4) — 5xx calendar.ics a kiosk', () => {
  let clone: LocalClone;
  let fc: Awaited<ReturnType<LocalClone['seed']['fullChain']>>;
  let ownerTok: string;
  let otherTok: string;

  beforeAll(async () => {
    clone = await createLocalClone();
    fc = await clone.seed.fullChain();
    const { signAccessToken } = await import('@/lib/auth');
    const tok = async (id: string) => {
      const email = (await clone.pool.query(`SELECT email FROM identity.users WHERE id=$1`, [id])).rows[0].email;
      return signAccessToken({ id, email, name: 'T' } as never, { isPlatformAdmin: false, promoterMemberships: [] } as never);
    };
    ownerTok = await tok(fc.userId);
    otherTok = await tok((await clone.seed.user('cizi')).id);
  }, 180_000);
  afterAll(async () => { await clone?.cleanup(); }, 30_000);

  const ics = async (orderId: string, h: Record<string, string> = {}) => {
    const { GET } = await import('@/app/api/buyer/orders/[orderId]/calendar.ics/route');
    return throughMiddleware(new Request(`http://localhost/api/buyer/orders/${orderId}/calendar.ics`, { headers: h }),
      GET as H, { params: { orderId } });
  };
  const kiosk = async (id: string) => {
    const { GET } = await import('@/app/api/public/events/[id]/kiosk/route');
    return throughMiddleware(new Request(`http://localhost/api/public/events/${id}/kiosk`), GET as H, { params: { id } });
  };

  it('calendar.ics: vlastník 200 s platným DTSTART; host s UUID 200 bez ID objednávky', async () => {
    const own = await ics(fc.orderId, { authorization: `Bearer ${ownerTok}` });
    const body = await own.text();
    expect(own.status, body).toBe(200);
    expect(own.headers.get('content-type')).toContain('text/calendar');
    expect(body).toMatch(/DTSTART:\d{8}T\d{6}Z/);
    expect(body).not.toContain(fc.orderId);
    const guest = await ics(fc.orderId);
    expect(guest.status, await guest.clone().text()).toBe(200);
    expect(await guest.text()).not.toContain(fc.orderId);
  });

  it('calendar.ics: cizí přihlášený 403, neplatné UUID 4xx, neexistující 404', async () => {
    expect((await ics(fc.orderId, { authorization: `Bearer ${otherTok}` })).status).toBe(403);
    const bad = await ics('not-a-uuid');
    expect(bad.status).toBeGreaterThanOrEqual(400);
    expect(bad.status).toBeLessThan(500);
    expect((await ics('00000000-0000-4000-8000-000000000000')).status).toBe(404);
  });

  it('kiosk: publikovaná akce 200 s typy a kapacitou; neplatné ID 422; nepublikovaná 404', async () => {
    const r = await kiosk(fc.eventId);
    const body = await r.text();
    expect(r.status, body).toBe(200);
    const j = JSON.parse(body) as { ticketTypes: { remainingQty: number; capacity: number }[]; totalCapacity: number };
    expect(j.ticketTypes.length).toBeGreaterThan(0);
    expect(j.totalCapacity).toBeGreaterThan(0);
    expect((await kiosk('xyz')).status).toBe(422);
    await clone.pool.query(`UPDATE catalog.events SET status='draft' WHERE id=$1`, [fc.eventId]);
    expect((await kiosk(fc.eventId)).status).toBe(404);
    await clone.pool.query(`UPDATE catalog.events SET status='published' WHERE id=$1`, [fc.eventId]);
  });
});
