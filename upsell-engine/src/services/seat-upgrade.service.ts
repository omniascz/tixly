import type { ServiceDeps, DbAdapter } from '../lib/service-container.js';
import { UpsellError } from '../lib/upsell-errors.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface UpgradeOption {
  fromSeatId: string;
  toSeatId: string;
  toZone: string;
  toRow: string;
  toSeatNumber: string;
  deltaHalire: number;
}

export interface PurchaseUpgradeResult {
  ticketId: string;
  newSeatInfo: string;
}

interface OrderSeatRow {
  ticket_id: string;
  seat_id: string;
  zone_id: string;
  zone_rank: number;
  price_halire: number;
  event_id: string;
}

interface CandidateSeatRow {
  seat_id: string;
  zone_id: string;
  zone_code: string;
  zone_rank: number;
  row_label: string;
  seat_number: string;
  price_halire: number;
}

// ─── findUpgradeOptions ───────────────────────────────────────────────────────

/**
 * Returns available seats in higher-ranked zones than the ones the order
 * currently holds, priced as the delta to pay.
 */
export async function findUpgradeOptions(
  orderId: string,
  deps: ServiceDeps,
): Promise<UpgradeOption[]> {
  // 1. Load current seats on the order
  const currentSeats = await deps.db.query<OrderSeatRow>(
    `SELECT t.id AS ticket_id, t.seat_id, s.zone_id, z.rank AS zone_rank,
            tt.price AS price_halire, t.event_id
     FROM ticketing.tickets t
     JOIN ticketing.seats s ON s.id = t.seat_id
     JOIN ticketing.zones z ON z.id = s.zone_id
     JOIN ticketing.ticket_types tt ON tt.id = t.ticket_type_id
     WHERE t.order_id = $1 AND t.status = 'paid'`,
    [orderId],
  );

  if (currentSeats.length === 0) return [];

  const options: UpgradeOption[] = [];

  for (const current of currentSeats) {
    // Find free seats in a higher-ranked zone of the same event
    const candidates = await deps.db.query<CandidateSeatRow>(
      `SELECT s.id AS seat_id, s.zone_id, z.code AS zone_code, z.rank AS zone_rank,
              s.row_label, s.seat_number, tt.price AS price_halire
       FROM ticketing.seats s
       JOIN ticketing.zones z ON z.id = s.zone_id
       JOIN ticketing.ticket_types tt ON tt.zone_id = z.id AND tt.event_id = $1
       WHERE z.event_id = $1
         AND z.rank > $2
         AND NOT EXISTS (
           SELECT 1 FROM ticketing.tickets t2
           WHERE t2.seat_id = s.id AND t2.status IN ('paid', 'reserved', 'pending')
         )
       ORDER BY z.rank ASC, s.row_label ASC, s.seat_number ASC
       LIMIT 20`,
      [current.event_id, current.zone_rank],
    );

    for (const c of candidates) {
      const delta = c.price_halire - current.price_halire;
      if (delta <= 0) continue;
      options.push({
        fromSeatId: current.seat_id,
        toSeatId: c.seat_id,
        toZone: c.zone_code,
        toRow: c.row_label,
        toSeatNumber: c.seat_number,
        deltaHalire: delta,
      });
    }
  }

  return options;
}

// ─── purchaseUpgrade ──────────────────────────────────────────────────────────

/**
 * Atomically upgrade a ticket from fromSeatId to toSeatId.
 * Uses SELECT FOR UPDATE on the target seat row to prevent double-booking
 * during concurrent upgrade attempts.
 */
export async function purchaseUpgrade(
  orderId: string,
  fromSeatId: string,
  toSeatId: string,
  paymentRef: string,
  deps: ServiceDeps,
): Promise<PurchaseUpgradeResult> {
  const result = await deps.db.transaction(async (tx: DbAdapter) => {
    // 1. Lock target seat + verify free
    const targetRows = await tx.query<{
      id: string;
      zone_id: string;
      row_label: string;
      seat_number: string;
      zone_code: string;
      zone_rank: number;
      event_id: string;
      price_halire: number;
    }>(
      `SELECT s.id, s.zone_id, s.row_label, s.seat_number,
              z.code AS zone_code, z.rank AS zone_rank, z.event_id,
              tt.price AS price_halire
       FROM ticketing.seats s
       JOIN ticketing.zones z ON z.id = s.zone_id
       JOIN ticketing.ticket_types tt ON tt.zone_id = z.id AND tt.event_id = z.event_id
       WHERE s.id = $1
       FOR UPDATE OF s`,
      [toSeatId],
    );

    if (targetRows.length === 0) {
      throw new UpsellError('UPSELL_NOT_FOUND', 'Target seat not found', 404);
    }
    const target = targetRows[0];

    const conflict = await tx.query<{ id: string }>(
      `SELECT id FROM ticketing.tickets
       WHERE seat_id = $1 AND status IN ('paid', 'reserved', 'pending')
       LIMIT 1`,
      [toSeatId],
    );
    if (conflict.length > 0) {
      throw new UpsellError('UPSELL_SOLD_OUT', 'Target seat no longer available', 409);
    }

    // 2. Lock source ticket + verify it belongs to this order
    const ticketRows = await tx.query<{
      id: string;
      order_id: string;
      seat_id: string;
      event_id: string;
      ticket_type_id: string;
      price: number;
    }>(
      `SELECT t.id, t.order_id, t.seat_id, t.event_id, t.ticket_type_id, tt.price
       FROM ticketing.tickets t
       JOIN ticketing.ticket_types tt ON tt.id = t.ticket_type_id
       WHERE t.order_id = $1 AND t.seat_id = $2 AND t.status = 'paid'
       FOR UPDATE OF t`,
      [orderId, fromSeatId],
    );
    if (ticketRows.length === 0) {
      throw new UpsellError('ORDER_NOT_FOUND', 'Source ticket not found on this order', 404);
    }
    const ticket = ticketRows[0];

    if (ticket.event_id !== target.event_id) {
      throw new UpsellError('UPSELL_NOT_AVAILABLE', 'Cross-event upgrade not allowed', 422);
    }

    const delta = target.price_halire - ticket.price;
    if (delta <= 0) {
      throw new UpsellError('UPSELL_NOT_AVAILABLE', 'Target seat is not an upgrade', 422);
    }

    // 3. Resolve the new ticket_type_id matching target zone
    const newTtRows = await tx.query<{ id: string }>(
      `SELECT id FROM ticketing.ticket_types
       WHERE event_id = $1 AND zone_id = $2
       LIMIT 1`,
      [target.event_id, target.zone_id],
    );
    if (newTtRows.length === 0) {
      throw new UpsellError('UPSELL_NOT_AVAILABLE', 'No ticket type for target zone', 422);
    }
    const newTicketTypeId = newTtRows[0].id;

    // 4. Record seat reservation for the new seat
    await tx.execute(
      `INSERT INTO ticketing.seat_reservations (seat_id, ticket_id, reserved_at, status)
       VALUES ($1, $2, NOW(), 'confirmed')`,
      [toSeatId, ticket.id],
    );

    // 5. Release the old seat reservation
    await tx.execute(
      `UPDATE ticketing.seat_reservations
       SET status = 'released', released_at = NOW()
       WHERE seat_id = $1 AND ticket_id = $2 AND status = 'confirmed'`,
      [fromSeatId, ticket.id],
    );

    // 6. Update the ticket itself
    await tx.execute(
      `UPDATE ticketing.tickets
       SET seat_id = $1,
           ticket_type_id = $2,
           updated_at = NOW()
       WHERE id = $3`,
      [toSeatId, newTicketTypeId, ticket.id],
    );

    // 7. Record upgrade payment reference
    await tx.execute(
      `INSERT INTO upsell.seat_upgrades
         (ticket_id, order_id, from_seat_id, to_seat_id, delta_halire, payment_ref, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
      [ticket.id, orderId, fromSeatId, toSeatId, delta, paymentRef],
    );

    return {
      ticketId: ticket.id,
      newSeatInfo: `${target.zone_code} / ${target.row_label} / ${target.seat_number}`,
      deltaHalire: delta,
      eventId: target.event_id,
    };
  });

  // 8. Emit Kafka event (post-commit, best-effort)
  await deps.kafka.send('upsell.seat_upgraded', {
    eventType: 'upsell.seat_upgraded',
    orderId,
    ticketId: result.ticketId,
    fromSeatId,
    toSeatId,
    deltaHalire: result.deltaHalire,
    eventId: result.eventId,
    paymentRef,
    timestamp: new Date().toISOString(),
  });

  return {
    ticketId: result.ticketId,
    newSeatInfo: result.newSeatInfo,
  };
}
