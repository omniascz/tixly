// =============================================================================
// RFID Service — Festival Wristband Fulfillment & Cashless Payments
// Feature #31: Issue RFID wristbands at entry, cashless tap-to-pay at venue
//
// Flow:
//   1. At entry: issueWristband() links RFID UID to ticket
//   2. Entry gate: scanEntry() validates wristband + records entry tap
//   3. Cashless: topUpWristband() loads credit, debitWristband() charges at stalls
// =============================================================================

export interface DbAdapter {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<void>;
}

export interface RfidWristband {
  id: string;
  eventId: string;
  ticketId: string;
  uid: string;
  status: 'issued' | 'active' | 'suspended' | 'blocked';
  balanceHellers: number;
  issuedAt: string;
  activatedAt: string | null;
  lastTapAt: string | null;
}

export interface RfidTap {
  id: string;
  wristbandId: string;
  tapType: 'entry' | 'payment' | 'top_up' | 'balance_check';
  amountHellers: number;
  balanceAfterHellers: number;
  terminalId: string;
  locationLabel: string | null;
  status: 'ok' | 'denied' | 'error';
  denyReason: string | null;
  tappedAt: string;
}

interface WristbandRow {
  id: string;
  event_id: string;
  ticket_id: string;
  uid: string;
  status: string;
  balance_hellers: number;
  issued_at: string;
  activated_at: string | null;
  last_tap_at: string | null;
}

interface TapRow {
  id: string;
  wristband_id: string;
  tap_type: string;
  amount_hellers: number;
  balance_after_hellers: number;
  terminal_id: string;
  location_label: string | null;
  status: string;
  deny_reason: string | null;
  tapped_at: string;
}

function mapWristband(r: WristbandRow): RfidWristband {
  return {
    id: r.id,
    eventId: r.event_id,
    ticketId: r.ticket_id,
    uid: r.uid,
    status: r.status as RfidWristband['status'],
    balanceHellers: r.balance_hellers,
    issuedAt: r.issued_at,
    activatedAt: r.activated_at,
    lastTapAt: r.last_tap_at,
  };
}

function mapTap(r: TapRow): RfidTap {
  return {
    id: r.id,
    wristbandId: r.wristband_id,
    tapType: r.tap_type as RfidTap['tapType'],
    amountHellers: r.amount_hellers,
    balanceAfterHellers: r.balance_after_hellers,
    terminalId: r.terminal_id,
    locationLabel: r.location_label,
    status: r.status as RfidTap['status'],
    denyReason: r.deny_reason,
    tappedAt: r.tapped_at,
  };
}

/**
 * Issue a new RFID wristband linked to a ticket at festival check-in.
 */
export async function issueWristband(
  eventId: string,
  ticketId: string,
  uid: string,
  db: DbAdapter,
): Promise<RfidWristband> {
  if (!uid || uid.trim() === '') {
    throw new Error('VALIDATION_ERROR: RFID UID is required');
  }

  const rows = await db.query<WristbandRow>(
    `INSERT INTO rfid.rfid_wristbands (event_id, ticket_id, uid, status, activated_at)
     VALUES ($1, $2, $3, 'active', NOW())
     RETURNING *`,
    [eventId, ticketId, uid.toUpperCase()],
  );

  return mapWristband(rows[0]);
}

/**
 * Look up a wristband by its hardware UID.
 */
export async function getWristbandByUid(uid: string, db: DbAdapter): Promise<RfidWristband | null> {
  const rows = await db.query<WristbandRow>(
    `SELECT * FROM rfid.rfid_wristbands WHERE uid = $1`,
    [uid.toUpperCase()],
  );
  return rows[0] ? mapWristband(rows[0]) : null;
}

/**
 * Record an entry gate scan. Returns 'ok' or 'denied' with reason.
 */
export async function scanEntry(
  uid: string,
  terminalId: string,
  locationLabel: string | null,
  db: DbAdapter,
): Promise<RfidTap> {
  const wristband = await getWristbandByUid(uid, db);

  if (!wristband) {
    return recordTap(null, 'entry', 0, 0, terminalId, locationLabel, 'error', 'WRISTBAND_NOT_FOUND', db);
  }

  if (wristband.status === 'blocked') {
    return recordTap(wristband.id, 'entry', 0, wristband.balanceHellers, terminalId, locationLabel, 'denied', 'WRISTBAND_BLOCKED', db);
  }

  if (wristband.status === 'suspended') {
    return recordTap(wristband.id, 'entry', 0, wristband.balanceHellers, terminalId, locationLabel, 'denied', 'WRISTBAND_SUSPENDED', db);
  }

  // Update last_tap_at
  await db.execute(
    `UPDATE rfid.rfid_wristbands SET last_tap_at = NOW() WHERE id = $1`,
    [wristband.id],
  );

  return recordTap(wristband.id, 'entry', 0, wristband.balanceHellers, terminalId, locationLabel, 'ok', null, db);
}

/**
 * Top up a wristband's cashless balance.
 */
export async function topUpWristband(
  uid: string,
  amountHellers: number,
  paymentMethod: 'card' | 'cash' | 'voucher' | 'promo',
  terminalId: string,
  externalPaymentId: string | null,
  processedBy: string | null,
  db: DbAdapter,
): Promise<RfidWristband> {
  if (amountHellers <= 0) {
    throw new Error('VALIDATION_ERROR: top-up amount must be positive');
  }

  const wristbands = await db.query<WristbandRow>(
    `UPDATE rfid.rfid_wristbands
     SET balance_hellers = balance_hellers + $2,
         last_tap_at = NOW()
     WHERE uid = $1 AND status NOT IN ('blocked')
     RETURNING *`,
    [uid.toUpperCase(), amountHellers],
  );

  if (!wristbands[0]) throw new Error('WRISTBAND_NOT_FOUND or WRISTBAND_BLOCKED');

  const wristband = wristbands[0];

  // Log the top-up tap
  await recordTap(wristband.id, 'top_up', amountHellers, wristband.balance_hellers, terminalId, null, 'ok', null, db);

  // Record in top-ups table
  await db.execute(
    `INSERT INTO rfid.rfid_top_ups (wristband_id, amount_hellers, payment_method, external_payment_id, processed_by)
     VALUES ($1, $2, $3, $4, $5)`,
    [wristband.id, amountHellers, paymentMethod, externalPaymentId, processedBy],
  );

  return mapWristband(wristband);
}

/**
 * Debit a wristband for a cashless purchase at a stall/bar.
 */
export async function debitWristband(
  uid: string,
  amountHellers: number,
  terminalId: string,
  locationLabel: string | null,
  db: DbAdapter,
): Promise<RfidTap> {
  if (amountHellers <= 0) {
    throw new Error('VALIDATION_ERROR: debit amount must be positive');
  }

  // Atomic: only deduct if sufficient balance
  const wristbands = await db.query<WristbandRow>(
    `UPDATE rfid.rfid_wristbands
     SET balance_hellers = balance_hellers - $2,
         last_tap_at = NOW()
     WHERE uid = $1
       AND status = 'active'
       AND balance_hellers >= $2
     RETURNING *`,
    [uid.toUpperCase(), amountHellers],
  );

  if (!wristbands[0]) {
    // Check if wristband exists to give a better error
    const existing = await getWristbandByUid(uid, db);
    if (!existing) {
      return recordTap(null, 'payment', -amountHellers, 0, terminalId, locationLabel, 'error', 'WRISTBAND_NOT_FOUND', db);
    }
    const reason = existing.balanceHellers < amountHellers ? 'INSUFFICIENT_BALANCE' : 'WRISTBAND_NOT_ACTIVE';
    return recordTap(existing.id, 'payment', -amountHellers, existing.balanceHellers, terminalId, locationLabel, 'denied', reason, db);
  }

  return recordTap(wristbands[0].id, 'payment', -amountHellers, wristbands[0].balance_hellers, terminalId, locationLabel, 'ok', null, db);
}

/**
 * Get the balance for a wristband.
 */
export async function getWristbandBalance(uid: string, db: DbAdapter): Promise<{ balanceHellers: number } | null> {
  const rows = await db.query<{ balance_hellers: number }>(
    `SELECT balance_hellers FROM rfid.rfid_wristbands WHERE uid = $1`,
    [uid.toUpperCase()],
  );
  return rows[0] ? { balanceHellers: rows[0].balance_hellers } : null;
}

// Internal helper to log taps
async function recordTap(
  wristbandId: string | null,
  tapType: RfidTap['tapType'],
  amountHellers: number,
  balanceAfterHellers: number,
  terminalId: string,
  locationLabel: string | null,
  status: RfidTap['status'],
  denyReason: string | null,
  db: DbAdapter,
): Promise<RfidTap> {
  if (!wristbandId) {
    // Return a virtual tap record without persisting (wristband not found)
    return {
      id: 'error',
      wristbandId: '',
      tapType,
      amountHellers,
      balanceAfterHellers,
      terminalId,
      locationLabel,
      status,
      denyReason,
      tappedAt: new Date().toISOString(),
    };
  }

  const rows = await db.query<TapRow>(
    `INSERT INTO rfid.rfid_taps
       (wristband_id, tap_type, amount_hellers, balance_after_hellers, terminal_id, location_label, status, deny_reason)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [wristbandId, tapType, amountHellers, balanceAfterHellers, terminalId, locationLabel, status, denyReason],
  );

  return mapTap(rows[0]);
}
