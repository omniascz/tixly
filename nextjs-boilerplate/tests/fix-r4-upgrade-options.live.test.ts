// @vitest-environment node
/**
 * Kolo 4 / krok 3f — GET /api/my/orders/[id]/upgrade-options vracel vždy 500: dotazy stály
 * na neexistujícím schématu (catalog.seat_maps, seat_map_entries, orders.seat_assignments,
 * ticket_types.section_id/price_halire, seats.row_label) — FIX_REPORT_R3 bod 4.
 *
 * Očekávané: vlastník zaplacené objednávky budoucí akce dostane 200 s vlastními platnými
 * vstupenkami a nabídkou dražších veřejných typů téže akce s volnou kapacitou (u sedadlových
 * i volná sedadla); levnější/vyprodané/skryté typy v nabídce nejsou; cizí objednávka → 404.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NextRequest } from 'next/server';
import { createLocalClone, hasLocalDb, type LocalClone } from './helpers/local-fixture';
import { throughMiddleware } from './helpers/through-middleware';

const run = describe.skipIf(!hasLocalDb);
type H = (r: NextRequest, ctx: unknown) => Promise<Response>;

run('Krok 3f (kolo 4) — upgrade-options na skutečném schématu', () => {
  let clone: LocalClone;
  let fc: Awaited<ReturnType<LocalClone['seed']['fullChain']>>;
  let vip: string;
  let ownerTok: string;
  let otherTok: string;

  beforeAll(async () => {
    clone = await createLocalClone();
    fc = await clone.seed.fullChain({ basePrice: 10000 });
    const tt = async (name: string, price: number, remaining: number, visibility = 'public') => (await clone.pool.query<{ id: string }>(
      `INSERT INTO catalog.ticket_types (event_id, name, kind, base_price, total_qty, remaining_qty, visibility)
       VALUES ($1,$2,'seated',$3,20,$4,$5) RETURNING id`, [fc.eventId, name, price, remaining, visibility])).rows[0].id;
    vip = await tt('VIP', 30000, 5);
    await tt('Levnější', 5000, 5);
    await tt('Vyprodáno', 40000, 0);
    await tt('Skryté', 50000, 5, 'hidden');
    await clone.pool.query(`INSERT INTO catalog.event_seats (event_id, ticket_type_id, sector, row, seat_number, status)
      VALUES ($1,$2,'Parter','A','1','available'), ($1,$2,'Parter','A','2','sold')`, [fc.eventId, vip]);
    const { signAccessToken } = await import('@/lib/auth');
    const t = async (id: string) => {
      const email = (await clone.pool.query(`SELECT email FROM identity.users WHERE id=$1`, [id])).rows[0].email;
      return signAccessToken({ id, email, name: 'U' } as never, { isPlatformAdmin: false, promoterMemberships: [] } as never);
    };
    ownerTok = await t(fc.userId);
    otherTok = await t((await clone.seed.user('cizi')).id);
  }, 180_000);
  afterAll(async () => { await clone?.cleanup(); }, 30_000);

  const call = async (tok: string) => {
    const { GET } = await import('@/app/api/my/orders/[id]/upgrade-options/route');
    const r = await throughMiddleware(new Request(`http://localhost/api/my/orders/${fc.orderId}/upgrade-options`, {
      headers: { authorization: `Bearer ${tok}` },
    }), GET as unknown as H, { params: { id: fc.orderId } });
    return { status: r.status, body: await r.text() };
  };

  it('vlastník: 200, vlastní vstupenka a jen dražší veřejný typ s kapacitou (+ volné sedadlo)', async () => {
    const r = await call(ownerTok);
    expect(r.status, r.body).toBe(200);
    const j = JSON.parse(r.body) as {
      tickets: { ticketId: string }[];
      availableUpgrades: { ticketTypeId: string; name: string; diffHalire: number; seats: { sector: string; row: string; seatNumber: string }[] }[];
    };
    expect(j.tickets).toHaveLength(1);
    expect(j.availableUpgrades.map((u) => u.name)).toEqual(['VIP']);
    expect(j.availableUpgrades[0]).toMatchObject({ ticketTypeId: vip, diffHalire: 20000 });
    expect(j.availableUpgrades[0].seats).toEqual([{ seatId: expect.any(String), sector: 'Parter', row: 'A', seatNumber: '1' }]);
  });

  it('cizí uživatel: 404', async () => {
    expect((await call(otherTok)).status).toBe(404);
  });
});
