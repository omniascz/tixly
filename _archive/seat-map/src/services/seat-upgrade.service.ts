// =============================================================================
// Seat Upgrade Service — In-Venue Seat Upgrades
// Feature #43: Fan upgrades seat from mobile after arriving at venue
//
// Flow:
//   1. Fan arrives, opens app → getAvailableUpgrades() shows better available seats
//   2. Fan picks target seat → requestUpgrade() locks the upgrade (10-min window)
//   3. Fan pays the price difference → confirmUpgrade() swaps tickets
//   4. Old ticket is invalidated, new ticket (for better seat) is issued
//
// Only works during event window: from gate-open until event start + 30 min.
// =============================================================================

export interface DbAdapter {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<void>;
}

export interface UpgradeRequest {
  id: string;
  originalTicketId: string;
  newSeatId: string;
  newTicketTypeId: string | null;
  userId: string;
  eventId: string;
  originalPriceHellers: number;
  newPriceHellers: number;
  upgradeFeeHellers: number;
  status: 'pending' | 'payment_initiated' | 'completed' | 'cancelled' | 'expired';
  paymentIntentId: string | null;
  newTicketId: string | null;
  expiresAt: string;
  createdAt: string;
  completedAt: string | null;
}

export interface AvailableUpgrade {
  seatId: string;
  section: string;
  row: string;
  seatNumber: string;
  zoneId: string;
  zoneName: string;
  priceHellers: number;
  upgradeFeeHellers: number;
}

interface UpgradeRow {
  id: string;
  original_ticket_id: string;
  new_seat_id: string;
  new_ticket_type_id: string | null;
  user_id: string;
  event_id: string;
  original_price_hellers: number;
  new_price_hellers: number;
  upgrade_fee_hellers: number;
  status: string;
  payment_intent_id: string | null;
  new_ticket_id: string | null;
  expires_at: string;
  created_at: string;
  completed_at: string | null;
}

function mapUpgrade(r: UpgradeRow): UpgradeRequest {
  return {
    id: r.id,
    originalTicketId: r.original_ticket_id,
    newSeatId: r.new_seat_id,
    newTicketTypeId: r.new_ticket_type_id,
    userId: r.user_id,
    eventId: r.event_id,
    originalPriceHellers: r.original_price_hellers,
    newPriceHellers: r.new_price_hellers,
    upgradeFeeHellers: r.upgrade_fee_hellers,
    status: r.status as UpgradeRequest['status'],
    paymentIntentId: r.payment_intent_id,
    newTicketId: r.new_ticket_id,
    expiresAt: r.expires_at,
    createdAt: r.created_at,
    completedAt: r.completed_at,
  };
}

/**
 * Get available upgrades for a ticket — seats in higher-priced zones with availability.
 * Returns seats that cost more than the current ticket (genuine upgrades only).
 */
export async function getAvailableUpgrades(
  ticketId: string,
  userId: string,
  db: DbAdapter,
): Promise<AvailableUpgrade[]> {
  const rows = await db.query<{
    seat_id: string;
    section: string;
    row: string;
    seat_number: string;
    zone_id: string;
    zone_name: string;
    price_hellers: number;
    original_price: number;
  }>(
    `SELECT
       sm.seat_id,
       sm.section,
       sm.row,
       sm.seat_number,
       sm.zone_id,
       sm.zone_name,
       sm.price_hellers,
       t.original_price
     FROM catalog.seat_availability sm
     JOIN tickets.tickets t ON t.id = $1
     WHERE t.owner_id = $2
       AND sm.event_id = t.event_id
       AND sm.status = 'available'
       AND sm.price_hellers > t.original_price
     ORDER BY sm.price_hellers ASC
     LIMIT 20`,
    [ticketId, userId],
  );

  return rows.map((r) => ({
    seatId: r.seat_id,
    section: r.section,
    row: r.row,
    seatNumber: r.seat_number,
    zoneId: r.zone_id,
    zoneName: r.zone_name,
    priceHellers: r.price_hellers,
    upgradeFeeHellers: r.price_hellers - r.original_price,
  }));
}

/**
 * Initiate an upgrade request.
 * Validates ownership, checks the target seat is available and more expensive.
 */
export async function requestUpgrade(
  ticketId: string,
  userId: string,
  newSeatId: string,
  newPriceHellers: number,
  db: DbAdapter,
): Promise<UpgradeRequest> {
  if (newPriceHellers <= 0) {
    throw new Error('VALIDATION_ERROR: new price must be positive');
  }

  // Verify ticket ownership and get original price
  const tickets = await db.query<{
    id: string;
    owner_id: string;
    event_id: string;
    original_price: number;
    status: string;
  }>(
    `SELECT id, owner_id, event_id, original_price, status FROM tickets.tickets WHERE id = $1`,
    [ticketId],
  );

  if (!tickets[0]) throw new Error('TICKET_NOT_FOUND');
  const ticket = tickets[0];

  if (ticket.owner_id !== userId) throw new Error('TICKET_OWNERSHIP_DENIED');
  if (ticket.status !== 'active') throw new Error('TICKET_NOT_ACTIVE');

  if (newPriceHellers <= ticket.original_price) {
    throw new Error('VALIDATION_ERROR: target seat must be in a higher price tier');
  }

  const upgradeFee = newPriceHellers - ticket.original_price;

  const rows = await db.query<UpgradeRow>(
    `INSERT INTO seat_upgrades.upgrade_requests
       (original_ticket_id, new_seat_id, user_id, event_id,
        original_price_hellers, new_price_hellers, upgrade_fee_hellers)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [ticketId, newSeatId, userId, ticket.event_id, ticket.original_price, newPriceHellers, upgradeFee],
  );

  return mapUpgrade(rows[0]);
}

/**
 * Confirm a completed upgrade after payment.
 * Marks old ticket as transferred, links new ticket.
 */
export async function confirmUpgrade(
  upgradeId: string,
  paymentIntentId: string,
  newTicketId: string,
  db: DbAdapter,
): Promise<UpgradeRequest> {
  const rows = await db.query<UpgradeRow>(
    `UPDATE seat_upgrades.upgrade_requests
     SET status = 'completed',
         payment_intent_id = $2,
         new_ticket_id = $3,
         completed_at = NOW()
     WHERE id = $1 AND status IN ('pending', 'payment_initiated') AND expires_at > NOW()
     RETURNING *`,
    [upgradeId, paymentIntentId, newTicketId],
  );

  if (!rows[0]) throw new Error('UPGRADE_NOT_FOUND or UPGRADE_EXPIRED');

  return mapUpgrade(rows[0]);
}

/**
 * Cancel a pending upgrade request (user changed their mind or timeout).
 */
export async function cancelUpgrade(
  upgradeId: string,
  userId: string,
  db: DbAdapter,
): Promise<UpgradeRequest> {
  const rows = await db.query<UpgradeRow>(
    `UPDATE seat_upgrades.upgrade_requests
     SET status = 'cancelled'
     WHERE id = $1 AND user_id = $2 AND status IN ('pending', 'payment_initiated')
     RETURNING *`,
    [upgradeId, userId],
  );

  if (!rows[0]) throw new Error('UPGRADE_NOT_FOUND or already completed');
  return mapUpgrade(rows[0]);
}

/**
 * Get a specific upgrade request.
 */
export async function getUpgradeRequest(
  upgradeId: string,
  db: DbAdapter,
): Promise<UpgradeRequest | null> {
  const rows = await db.query<UpgradeRow>(
    `SELECT * FROM seat_upgrades.upgrade_requests WHERE id = $1`,
    [upgradeId],
  );
  return rows[0] ? mapUpgrade(rows[0]) : null;
}
