// @vitest-environment node
/**
 * Kolo 9 / krok 1 — skener: vstupenka jiného termínu. Hláška musí říct, NA KTERÝ termín vstupenka platí:
 * název inscenace, datum, čas a město (u turné stejné inscenace samotný název nestačí).
 */
import { randomUUID } from 'crypto';
import type { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLocalClone, hasLocalDb, type LocalClone } from './helpers/local-fixture';
import { throughMiddleware } from './helpers/through-middleware';

const run = describe.skipIf(!hasLocalDb);
type H = (r: NextRequest, ctx?: unknown) => Promise<Response>;

run('Kolo 9 — skener: jiný termín', () => {
  let clone: LocalClone;
  afterAll(async () => { await clone?.cleanup(); }, 60_000);
  beforeAll(async () => { clone = await createLocalClone(); }, 120_000);

  it('hláška obsahuje inscenaci, datum, čas a město termínu, na který vstupenka platí', async () => {
    const c = await clone.seed.chain();
    const productionId = (await clone.pool.query<{ id: string }>(
      `INSERT INTO catalog.productions (promoter_id, title) VALUES ($1, 'Racek') RETURNING id`, [c.promoterId])).rows[0].id;
    const ostrava = randomUUID();
    await clone.pool.query(`INSERT INTO catalog.venues (id, name, city, country, capacity) VALUES ($1, 'Komorní scéna', 'Ostrava', 'CZ', 80)`, [ostrava]);
    // termín A (brána) = c.eventId (Praha); termín B (vstupenka) = Ostrava 29. 10. 2027 19:30 místního času
    const termB = randomUUID();
    await clone.pool.query(
      `INSERT INTO catalog.events (id, organizer_id, promoter_id, venue_id, title, slug, status, currency, event_type, date_start, production_id)
       VALUES ($1, $2, $2, $3, 'Racek', $4, 'published', 'CZK', 'theatre', '2027-10-29 19:30:00 Europe/Prague', $5)`,
      [termB, c.promoterId, ostrava, `racek-${termB.slice(0, 8)}`, productionId]);
    await clone.pool.query(`UPDATE catalog.events SET production_id = $2, title = 'Racek' WHERE id = $1`, [c.eventId, productionId]);
    const ttB = (await clone.pool.query<{ id: string }>(
      `INSERT INTO catalog.ticket_types (event_id, name, kind, base_price, total_qty, remaining_qty, visibility, vat_rate_code)
       VALUES ($1, 'Standard', 'standing', 30000, 10, 10, 'public', 'CZ_REDUCED') RETURNING id`, [termB])).rows[0].id;
    const ord = await clone.seed.order({ ...c, eventId: termB, ticketTypeId: ttB });
    const tid = (await clone.seed.tickets(ord.orderId))[0].ticketId;

    const { signAccessToken } = await import('@/lib/auth');
    const email = (await clone.pool.query(`SELECT email FROM identity.users WHERE id=$1`, [c.adminUserId])).rows[0].email;
    const tok = await signAccessToken({ id: c.adminUserId, email, name: 'U' } as never, {
      isPlatformAdmin: false, promoterMemberships: [{ promoterId: c.promoterId, slug: 'x', name: 'x', status: 'active', role: 'owner' }],
    } as never);
    const { POST } = await import('@/app/api/admin/scanner/validate/route');
    const r = await throughMiddleware(new Request('http://localhost/api/admin/scanner/validate', {
      method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://localhost', authorization: `Bearer ${tok}` },
      body: JSON.stringify({ ticketId: tid, eventId: c.eventId }),
    }), POST as unknown as H);
    const j = await r.json() as { result: string; message: string; validFor?: Record<string, string> };
    expect(r.status).toBe(409);
    expect(j.result).toBe('wrong_event');
    expect(j.message).toBe('Lístek platí na jiný termín: Racek — 29. 10. 2027 19:30, Ostrava (Komorní scéna).');
    expect(j.validFor).toEqual({ title: 'Racek', date: '29. 10. 2027', time: '19:30', city: 'Ostrava', venue: 'Komorní scéna' });
  });
});
