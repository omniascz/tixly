// @vitest-environment node
/**
 * Kolo 5 / integrace — režim „průchod" (POST /api/admin/scanner/passage, kód vlastníka) obcházel
 * politiku QR: holé UUID vstupenky prošlo bez TOTP i u `rotating_24h` 1 h před akcí, kde
 * /api/admin/scanner/validate vyžaduje rotující QR (kolo 2) nebo podepsaný tisk TXP2 (kolo 4).
 * Zároveň průchod neznal `printToken`, takže tištěná vstupenka TXP2 v tomto režimu skončila 422.
 *
 * Očekávané (stejně jako validate): rotating_24h do 24 h → bez TOTP 401 totp_required a vstupenka
 * zůstane venku; platný TXP2 této akce TOTP nahradí (200 admitted); padělaný token 401;
 * static_allowed holé UUID dál projde.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NextRequest } from 'next/server';
import { createLocalClone, hasLocalDb, type LocalClone } from './helpers/local-fixture';
import { throughMiddleware } from './helpers/through-middleware';

const run = describe.skipIf(!hasLocalDb);
type H = (r: NextRequest, ctx: unknown) => Promise<Response>;

run('Kolo 5 — průchod (passage) dodržuje politiku QR jako validate', () => {
  let clone: LocalClone;
  let fc: Awaited<ReturnType<LocalClone['seed']['chain']>> & { orderId: string };
  let tok: string;
  let tickets: string[];

  beforeAll(async () => {
    clone = await createLocalClone();
    const c = await clone.seed.chain();
    const o = await clone.seed.order(c, { quantity: 3 });
    await clone.seed.tickets(o.orderId);
    fc = { ...c, orderId: o.orderId };
    await clone.pool.query(`UPDATE platform.promoters SET status='active' WHERE id=$1`, [fc.promoterId]);
    await clone.pool.query(
      `UPDATE catalog.events SET qr_policy='rotating_24h', reentry_allowed=TRUE, date_start = NOW() + INTERVAL '1 hour' WHERE id=$1`,
      [fc.eventId],
    );
    tickets = (await clone.pool.query<{ id: string }>(`SELECT id FROM tickets.tickets WHERE order_id=$1 ORDER BY id`, [fc.orderId])).rows.map((r) => r.id);
    const email = (await clone.pool.query(`SELECT email FROM identity.users WHERE id=$1`, [fc.adminUserId])).rows[0].email;
    const { signAccessToken } = await import('@/lib/auth');
    tok = await signAccessToken({ id: fc.adminUserId, email, name: 'S' } as never, {
      isPlatformAdmin: false, promoterMemberships: [{ promoterId: fc.promoterId, slug: 'x', name: 'x', status: 'active', role: 'owner' }],
    } as never);
  }, 180_000);
  afterAll(async () => { await clone?.cleanup(); }, 30_000);

  const passage = async (body: Record<string, unknown>) => {
    const { POST } = await import('@/app/api/admin/scanner/passage/route');
    const r = await throughMiddleware(new Request('http://localhost/api/admin/scanner/passage', {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${tok}` },
      body: JSON.stringify(body),
    }), POST as unknown as H, {});
    return { status: r.status, body: await r.text() };
  };
  const inside = async (id: string) =>
    (await clone.pool.query<{ i: boolean }>(`SELECT currently_inside i FROM tickets.tickets WHERE id=$1`, [id])).rows[0].i;

  it('rotating_24h 1 h před akcí: holé UUID bez TOTP → 401 totp_required, vstupenka zůstane venku', async () => {
    expect(tickets.length).toBeGreaterThanOrEqual(1);
    const r = await passage({ ticketId: tickets[0] });
    expect(r.status, r.body).toBe(401);
    expect(r.body).toMatch(/totp_required/);
    expect(await inside(tickets[0])).toBe(false);
  });

  it('tištěná vstupenka TXP2 této akce nahradí TOTP → 200 admitted', async () => {
    const { signEventPrintToken } = await import('@/lib/tickets/print-token');
    const r = await passage({ printToken: signEventPrintToken(tickets[0], fc.eventId) });
    expect(r.status, r.body).toBe(200);
    expect(r.body).toMatch(/admitted/);
    expect(await inside(tickets[0])).toBe(true);
  });

  it('padělaný / cizí tiskový token → 401, vstupenka zůstane venku', async () => {
    const { signEventPrintToken } = await import('@/lib/tickets/print-token');
    const other = tickets[1] ?? tickets[0];
    const foreignEvent = '00000000-0000-4000-8000-000000000001';
    const r = await passage({ printToken: signEventPrintToken(other, foreignEvent) });
    expect(r.status, r.body).toBe(401);
    if (tickets[1]) expect(await inside(tickets[1])).toBe(false);
  });

  it('static_allowed: holé UUID dál projde (žádná regrese)', async () => {
    await clone.pool.query(`UPDATE catalog.events SET qr_policy='static_allowed' WHERE id=$1`, [fc.eventId]);
    const id = tickets[2] ?? tickets[1] ?? tickets[0];
    if (await inside(id)) return;
    const r = await passage({ ticketId: id });
    expect(r.status, r.body).toBe(200);
    expect(await inside(id)).toBe(true);
  });
});
