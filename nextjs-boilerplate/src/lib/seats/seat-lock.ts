/**
 * Seat lock kontrakt — JEDINÁ autorita pro seat reservation flow.
 *
 * Stávající stav (audit B14, 2026-04-26):
 *   • `catalog.seats.status` ∈ {'available', 'locked', 'sold', 'blocked'}
 *     + `locked_by_order_id` + `locked_until` — to je kanonický stav.
 *   • `seat_holds.seat_holds` (released_at IS NULL) — production holdy
 *     (artist/sponsor/press/accessibility) které **mají precedenci** před
 *     prodejem. Checkout je MUSÍ kontrolovat před lockem.
 *   • `orders.seat_locks` — **NEEXISTUJE** v aktuálním schématu, byť na ni
 *     referuje původní `/api/checkout/route.ts`. Mrtvý kód, smazat při
 *     konsolidaci checkout cest.
 *
 * Kontrakt:
 *   1. **`acquireSeatLocks(seatIds, orderId, ttlMinutes, db)`** — atomické v transakci:
 *      a) odmítne, pokud kterékoli sedadlo je v aktivním seat_hold
 *         (`seat_holds.seat_holds WHERE released_at IS NULL`)
 *      b) UPDATE catalog.seats SET status='locked' WHERE status='available'
 *         AND id = ANY(...) RETURNING id; když počet RETURNING < požadavek,
 *         dojde k ROLLBACK + chybě SEAT_UNAVAILABLE.
 *   2. **`releaseSeatLocks(orderId, db)`** — release při ROLLBACK / payment fail.
 *   3. **`finalizeSeatLocks(orderId, db)`** — locked → sold po úspěšné platbě.
 *   4. **`reapExpiredSeatLocks(db)`** — cron job (každou minutu): locked + locked_until < NOW
 *      → available. Bez něj zůstanou orphaned locks po pádu serveru.
 *
 * Race conditions:
 *   • Dva souběžní kupci na stejné sedadlo: `WHERE status='available'` v
 *     UPDATE je atomické — druhý dostane RETURNING [], všechny své locky
 *     odmítne, a transakci rolls back.
 *   • Hold přidán mid-checkout: protože checkujeme holdy PŘED lockem
 *     a UPDATE je SERIALIZABLE-safe, hold zaregistrovaný po naší kontrole
 *     ale před UPDATE může způsobit, že lockneme „blokované" sedadlo.
 *     Mitigace: holdy sazet jen v idle období; nebo přepnout na SELECT FOR
 *     UPDATE před locks (cena: výkon).
 */

import type { Pool, PoolClient } from 'pg';

export type SeatDb = Pool | PoolClient;

export class SeatUnavailableError extends Error {
  readonly code = 'SEAT_UNAVAILABLE' as const;
  constructor(
    readonly seatId: string,
    readonly reason: 'in_hold' | 'not_available' | 'unknown',
  ) {
    super(`Sedadlo ${seatId} není k dispozici (${reason}).`);
    this.name = 'SeatUnavailableError';
  }
}

/**
 * Pokusí se atomicky zamknout dané seaty pro objednávku.
 * Volat v transakci. Vyhodí SeatUnavailableError, pokud kterékoli z nich
 * již není available nebo je v aktivním holdu.
 */
export async function acquireSeatLocks(
  seatIds: string[],
  orderId: string,
  ttlMinutes: number,
  db: SeatDb,
): Promise<void> {
  if (seatIds.length === 0) return;

  // 1) Production holds check — žádný seat ve výběru nesmí mít aktivní hold
  const holdsRes = await db.query<{ seat_id: string }>(
    `SELECT seat_id::uuid AS seat_id
     FROM seat_holds.seat_holds h
     JOIN catalog.seats s ON s.id::text = h.seat_id
     WHERE s.id = ANY($1::uuid[]) AND h.released_at IS NULL
     LIMIT 1`,
    [seatIds],
  );
  if (holdsRes.rows.length > 0) {
    throw new SeatUnavailableError(holdsRes.rows[0]!.seat_id, 'in_hold');
  }

  // 2) Atomický lock: jen pokud je status='available'
  const lockRes = await db.query<{ id: string }>(
    `UPDATE catalog.seats
     SET status = 'locked',
         locked_by_order_id = $2,
         locked_until = NOW() + ($3 || ' minutes')::interval
     WHERE id = ANY($1::uuid[]) AND status = 'available'
     RETURNING id`,
    [seatIds, orderId, String(ttlMinutes)],
  );

  if (lockRes.rows.length !== seatIds.length) {
    const lockedIds = new Set(lockRes.rows.map((r) => r.id));
    const failed = seatIds.find((id) => !lockedIds.has(id));
    throw new SeatUnavailableError(failed ?? '?', 'not_available');
  }
}

/**
 * Uvolní všechny locky dané objednávky (rollback / payment failure).
 */
export async function releaseSeatLocks(orderId: string, db: SeatDb): Promise<void> {
  await db.query(
    `UPDATE catalog.seats
     SET status = 'available',
         locked_by_order_id = NULL,
         locked_until = NULL
     WHERE locked_by_order_id = $1 AND status = 'locked'`,
    [orderId],
  );
}

/**
 * Po úspěšné platbě překlopí locky na 'sold'. locked_by_order_id zůstává
 * jako historická reference (až do anonymizace).
 */
export async function finalizeSeatLocks(orderId: string, db: SeatDb): Promise<number> {
  const r = await db.query<{ id: string }>(
    `UPDATE catalog.seats
     SET status = 'sold',
         locked_until = NULL
     WHERE locked_by_order_id = $1 AND status = 'locked'
     RETURNING id`,
    [orderId],
  );
  return r.rows.length;
}

/**
 * Cron job (~ každou minutu): vyčistí expirované locky.
 * Vrací počet uvolněných sedadel.
 */
export async function reapExpiredSeatLocks(db: SeatDb): Promise<number> {
  const r = await db.query<{ id: string }>(
    `UPDATE catalog.seats
     SET status = 'available',
         locked_by_order_id = NULL,
         locked_until = NULL
     WHERE status = 'locked' AND locked_until < NOW()
     RETURNING id`,
  );
  return r.rows.length;
}
