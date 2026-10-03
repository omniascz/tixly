/**
 * Opětovná rezervace kapacity pro objednávku, jejíž kapacita už byla uvolněna
 * (`releaseOrderCapacity` — expirace / zrušení), ale platba za ni přesto dorazila (R6).
 *
 * Zrcadlo `releaseOrderCapacity`: tytéž zdroje (GA množství, sedadla, promo použití),
 * opačný směr, a stejně podmíněně jako checkout — `WHERE remaining_qty >= qty`, sedadlo
 * jen když je `available`, promo jen pod `max_uses`. Všechno nebo nic (SAVEPOINT):
 * nikdy se nevydá lístek nad kapacitu.
 *
 * Sedadla: checkout váže sedadlo na objednávku přes `event_seats.order_id`, které
 * `releaseOrderCapacity` vynuluje — po expiraci už nevíme, která sedadla objednávka držela,
 * pokud nejsou v `order_items.seat_id`. Sedadlový typ bez `seat_id` proto vrací
 * `SEATS_UNKNOWN` (→ volající refunduje), místo aby sedadla hádal.
 */
import type { PoolClient } from 'pg';

export type ReacquireResult =
  | { ok: true }
  | { ok: false; reason: 'SOLD_OUT' | 'SEATS_TAKEN' | 'SEATS_UNKNOWN' | 'PROMO_EXHAUSTED' };

/** @param client aktivní klient V TRANSAKCI (volající řídí BEGIN/COMMIT) */
export async function reacquireOrderCapacity(client: PoolClient, orderId: string): Promise<ReacquireResult> {
  await client.query('SAVEPOINT reacquire_capacity');
  const fail = async (reason: Exclude<ReacquireResult, { ok: true }>['reason']): Promise<ReacquireResult> => {
    await client.query('ROLLBACK TO SAVEPOINT reacquire_capacity');
    return { ok: false, reason };
  };

  // 1) GA množství — podmíněně, po typech (stejně jako checkout).
  const items = await client.query<{ ticket_type_id: string; qty: number; is_seated: boolean; seat_ids: string[] }>(
    `SELECT oi.ticket_type_id, SUM(oi.quantity)::int AS qty, bool_or(COALESCE(tt.is_seated, false)) AS is_seated,
            COALESCE(array_agg(oi.seat_id) FILTER (WHERE oi.seat_id IS NOT NULL), '{}') AS seat_ids
       FROM orders.order_items oi
       JOIN catalog.ticket_types tt ON tt.id = oi.ticket_type_id
      WHERE oi.order_id = $1
      GROUP BY oi.ticket_type_id`,
    [orderId],
  );
  for (const it of items.rows) {
    const r = await client.query(
      `UPDATE catalog.ticket_types SET remaining_qty = remaining_qty - $1
        WHERE id = $2 AND remaining_qty >= $1`,
      [it.qty, it.ticket_type_id],
    );
    if ((r.rowCount ?? 0) === 0) return fail('SOLD_OUT');
  }

  // 2) Sedadla — jen ta, o kterých víme; jen když jsou volná.
  for (const it of items.rows) {
    if (!it.is_seated) continue;
    if (it.seat_ids.length === 0) return fail('SEATS_UNKNOWN');
    const r = await client.query(
      `UPDATE catalog.event_seats
          SET status = 'sold', order_id = $2, hold_user_id = NULL, hold_until = NULL, updated_at = now()
        WHERE id = ANY($1::uuid[]) AND status = 'available'`,
      [it.seat_ids, orderId],
    );
    if ((r.rowCount ?? 0) !== it.seat_ids.length) return fail('SEATS_TAKEN');
  }

  // 3) Promo použití zpět (release ho odečetl).
  const promo = await client.query<{ promo_code_id: string | null }>(
    `SELECT promo_code_id FROM orders.orders WHERE id = $1`,
    [orderId],
  );
  const promoId = promo.rows[0]?.promo_code_id;
  if (promoId) {
    const r = await client.query(
      `UPDATE marketing.promo_codes SET uses_count = uses_count + 1, updated_at = now()
        WHERE id = $1 AND (max_uses IS NULL OR uses_count < max_uses)`,
      [promoId],
    );
    if ((r.rowCount ?? 0) === 0) return fail('PROMO_EXHAUSTED');
  }

  await client.query('RELEASE SAVEPOINT reacquire_capacity');
  return { ok: true };
}
