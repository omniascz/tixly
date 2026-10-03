// @vitest-environment node
/**
 * Kolo 4 / krok 3 — cron seat-upgrade-notify četl neexistující sloupce (FIX_REPORT_R3 bod 4):
 * `catalog.seats` (sedadla SÁLU, bez event_id/zone_name/row_label/label/is_available/is_held)
 * místo `catalog.event_seats`, a `orders.seat_upgrades.order_id/notified_at` (tabulka eviduje
 * skutečné upgrady, ty sloupce nemá). Cron proto vždy spadl a e-mail stejně jen logoval.
 *
 * Očekávané: kupec zaplaceného sedadla, pro které je ve stejné akci, typu a sektoru volné
 * lepší místo (nižší řada / nižší číslo), dostane e-mail; opakovaný běh do 7 dní znovu neposílá;
 * kupec bez lepšího místa e-mail nedostane. Cron vrací ok:true.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NextRequest } from 'next/server';
import { createLocalClone, hasLocalDb, mailpitLatest, type LocalClone } from './helpers/local-fixture';
import { throughMiddleware } from './helpers/through-middleware';

const run = describe.skipIf(!hasLocalDb);
type H = (r: NextRequest, ctx: unknown) => Promise<Response>;

run('Krok 3 (kolo 4) — seat-upgrade-notify', () => {
  let clone: LocalClone;
  let buyerEmail: string;
  let bestEmail: string;
  let orderId: string;

  beforeAll(async () => {
    clone = await createLocalClone();
    const c = await clone.seed.chain({ kind: 'seated' });
    await clone.pool.query(`UPDATE catalog.ticket_types SET is_seated = true WHERE id=$1`, [c.ticketTypeId]);
    await clone.pool.query(`UPDATE catalog.events SET date_start = NOW() + INTERVAL '10 days' WHERE id=$1`, [c.eventId]);
    const seat = async (row: string, num: string, status: string) => (await clone.pool.query<{ id: string }>(
      `INSERT INTO catalog.event_seats (event_id, ticket_type_id, sector, row, seat_number, status)
       VALUES ($1,$2,'Parter',$3,$4,$5) RETURNING id`, [c.eventId, c.ticketTypeId, row, num, status])).rows[0].id;
    const mine = await seat('C', '9', 'sold');
    await seat('B', '10', 'available');          // lepší řada (B < C) → upgrade možný
    const best = await seat('A', '1', 'sold');   // nejlepší místo — pro něj nic lepšího volného není
    const o1 = await clone.seed.order(c);
    orderId = o1.orderId;
    await clone.pool.query(`UPDATE orders.order_items SET seat_id=$2 WHERE order_id=$1`, [o1.orderId, mine]);
    buyerEmail = (await clone.pool.query(`SELECT email FROM identity.users WHERE id=$1`, [o1.userId])).rows[0].email;
    const o2 = await clone.seed.order(c);
    await clone.pool.query(`UPDATE orders.order_items SET seat_id=$2 WHERE order_id=$1`, [o2.orderId, best]);
    bestEmail = (await clone.pool.query(`SELECT email FROM identity.users WHERE id=$1`, [o2.userId])).rows[0].email;
  }, 180_000);
  afterAll(async () => { await clone?.cleanup(); }, 30_000);

  const cron = async () => {
    const { POST } = await import('@/app/api/internal/cron/seat-upgrade-notify/route');
    const r = await throughMiddleware(new Request('http://localhost/api/internal/cron/seat-upgrade-notify', {
      method: 'POST', headers: { 'x-internal-token': process.env.INTERNAL_SERVICE_TOKEN! },
    }), POST as unknown as H, {});
    return { status: r.status, body: await r.json().catch(() => null) as { ok?: boolean; notified?: number; failed?: number } | null };
  };

  it('pošle e-mail kupci s lepším volným místem, ne kupci nejlepšího místa', async () => {
    const r = await cron();
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body?.ok, JSON.stringify(r.body)).toBe(true);
    const mail = await mailpitLatest(buyerEmail);
    expect(mail, 'e-mail kupci s lepším místem').not.toBeNull();
    expect(mail!.html).toContain('Parter');
    expect(await mailpitLatest(bestEmail)).toBeNull();
    const n = (await clone.pool.query(`SELECT count(*)::int AS n FROM orders.seat_upgrade_notifications WHERE order_id=$1`, [orderId])).rows[0].n;
    expect(n).toBe(1);
  });

  it('opakovaný běh do 7 dní stejnému kupci neposílá', async () => {
    const r = await cron();
    expect(r.body?.ok).toBe(true);
    const n = (await clone.pool.query(`SELECT notified_at FROM orders.seat_upgrade_notifications WHERE order_id=$1`, [orderId])).rows.length;
    expect(n).toBe(1);
    expect(r.body?.notified ?? 0).toBe(0);
  });
});
