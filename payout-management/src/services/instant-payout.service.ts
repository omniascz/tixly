import type {
  InstantPayout,
  InstantPayoutInput,
  InstantPayoutStatus,
  StripeAdapter,
} from '../types/instant-payout.types.js';
import { InstantPayoutError } from '../types/instant-payout.types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MIN_AMOUNT_CZK = 500;
const MAX_AMOUNT_CZK = 500_000;
const FEE_RATE = 0.01;       // 1%
const MIN_FEE_CZK = 10;
const MAX_FEE_CZK = 200;

// ---------------------------------------------------------------------------
// Adapters
// ---------------------------------------------------------------------------

export interface DbAdapter {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<void>;
  transaction<T>(fn: (tx: DbAdapter) => Promise<T>): Promise<T>;
}

export interface ServiceDeps {
  db: DbAdapter;
  stripe: StripeAdapter;
}

// ---------------------------------------------------------------------------
// Internal DB row type
// ---------------------------------------------------------------------------

interface InstantPayoutRow {
  id: string;
  promoter_id: string;
  amount_czk: number;
  fee_czk: number;
  net_amount_czk: number;
  method: string;
  destination_id: string;
  status: InstantPayoutStatus;
  stripe_payout_id: string | null;
  failure_reason: string | null;
  requested_at: string;
  processed_at: string | null;
}

// ---------------------------------------------------------------------------
// Mapping helpers
// ---------------------------------------------------------------------------

function mapRow(row: InstantPayoutRow): InstantPayout {
  return {
    id: row.id,
    promoterId: row.promoter_id,
    amountCzk: row.amount_czk,
    feeCzk: row.fee_czk,
    netAmountCzk: row.net_amount_czk,
    method: row.method as InstantPayout['method'],
    destinationId: row.destination_id,
    status: row.status,
    stripePayoutId: row.stripe_payout_id,
    failureReason: row.failure_reason,
    requestedAt: new Date(row.requested_at),
    processedAt: row.processed_at ? new Date(row.processed_at) : null,
  };
}

// ---------------------------------------------------------------------------
// Fee calculation
// ---------------------------------------------------------------------------

export function calculateFee(amountCzk: number): number {
  const raw = Math.round(amountCzk * FEE_RATE);
  return Math.min(Math.max(raw, MIN_FEE_CZK), MAX_FEE_CZK);
}

// ---------------------------------------------------------------------------
// requestInstantPayout
// ---------------------------------------------------------------------------

export async function requestInstantPayout(
  input: InstantPayoutInput,
  deps: ServiceDeps,
): Promise<InstantPayout> {
  const { db, stripe } = deps;

  // Validate amount
  if (input.amountCzk < MIN_AMOUNT_CZK) {
    throw new InstantPayoutError(
      'AMOUNT_TOO_LOW',
      `Minimum instant payout amount is ${MIN_AMOUNT_CZK} CZK.`,
    );
  }
  if (input.amountCzk > MAX_AMOUNT_CZK) {
    throw new InstantPayoutError(
      'AMOUNT_TOO_HIGH',
      `Maximum instant payout amount is ${MAX_AMOUNT_CZK} CZK.`,
    );
  }

  // Check for pending payout
  const existing = await db.query<InstantPayoutRow>(
    `SELECT * FROM instant_payouts WHERE promoter_id = $1 AND status = 'pending' LIMIT 1`,
    [input.promoterId],
  );
  if (existing.length > 0) {
    throw new InstantPayoutError(
      'PENDING_PAYOUT_EXISTS',
      'A pending instant payout already exists for this promoter.',
    );
  }

  const feeCzk = calculateFee(input.amountCzk);
  const netAmountCzk = input.amountCzk - feeCzk;

  return db.transaction(async (tx) => {
    // Insert row with status 'pending'
    const inserted = await tx.query<InstantPayoutRow>(
      `INSERT INTO instant_payouts
         (promoter_id, amount_czk, fee_czk, net_amount_czk, method, destination_id, status,
          stripe_payout_id, failure_reason, requested_at, processed_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending', NULL, NULL, NOW(), NULL)
       RETURNING *`,
      [
        input.promoterId,
        input.amountCzk,
        feeCzk,
        netAmountCzk,
        input.method,
        input.destinationId,
      ],
    );

    const row = inserted[0];
    if (!row) {
      throw new InstantPayoutError('STRIPE_ERROR', 'Failed to insert instant payout row.');
    }

    // Call Stripe
    let stripeId: string;
    try {
      const result = await stripe.createInstantPayout({
        amount: input.amountCzk * 100, // CZK to halire (cents)
        currency: 'czk',
        method: input.method,
        destination: input.destinationId,
      });
      stripeId = result.id;
    } catch (err) {
      throw new InstantPayoutError(
        'STRIPE_ERROR',
        err instanceof Error ? err.message : 'Stripe call failed.',
      );
    }

    // Update to 'processing' with stripe payout ID
    const updated = await tx.query<InstantPayoutRow>(
      `UPDATE instant_payouts
       SET status = 'processing', stripe_payout_id = $1
       WHERE id = $2
       RETURNING *`,
      [stripeId, row.id],
    );

    const updatedRow = updated[0];
    if (!updatedRow) {
      throw new InstantPayoutError('STRIPE_ERROR', 'Failed to update instant payout status.');
    }

    return mapRow(updatedRow);
  });
}

// ---------------------------------------------------------------------------
// processInstantPayout
// ---------------------------------------------------------------------------

export async function processInstantPayout(
  payoutId: string,
  deps: ServiceDeps,
): Promise<InstantPayout> {
  const { db, stripe } = deps;

  const rows = await db.query<InstantPayoutRow>(
    `SELECT * FROM instant_payouts WHERE id = $1`,
    [payoutId],
  );

  const row = rows[0];
  if (!row) {
    throw new InstantPayoutError('PAYOUT_NOT_FOUND', `Instant payout ${payoutId} not found.`);
  }

  if (!row.stripe_payout_id) {
    return mapRow(row);
  }

  const stripeStatus = await stripe.getPayoutStatus(row.stripe_payout_id);

  let newStatus: InstantPayoutStatus = row.status;
  let failureReason: string | null = row.failure_reason;

  if (stripeStatus.status === 'paid') {
    newStatus = 'paid';
  } else if (stripeStatus.status === 'failed') {
    newStatus = 'failed';
    failureReason = stripeStatus.failureMessage ?? 'Unknown failure';
  } else if (stripeStatus.status === 'canceled' || stripeStatus.status === 'cancelled') {
    newStatus = 'cancelled';
  }

  if (newStatus === row.status) {
    return mapRow(row);
  }

  const updated = await db.query<InstantPayoutRow>(
    `UPDATE instant_payouts
     SET status = $1, failure_reason = $2, processed_at = NOW()
     WHERE id = $3
     RETURNING *`,
    [newStatus, failureReason, payoutId],
  );

  const updatedRow = updated[0];
  if (!updatedRow) {
    throw new InstantPayoutError('PAYOUT_NOT_FOUND', `Instant payout ${payoutId} not found after update.`);
  }

  return mapRow(updatedRow);
}

// ---------------------------------------------------------------------------
// getInstantPayoutStatus
// ---------------------------------------------------------------------------

export async function getInstantPayoutStatus(
  payoutId: string,
  deps: ServiceDeps,
): Promise<InstantPayout> {
  const { db } = deps;

  const rows = await db.query<InstantPayoutRow>(
    `SELECT * FROM instant_payouts WHERE id = $1`,
    [payoutId],
  );

  const row = rows[0];
  if (!row) {
    throw new InstantPayoutError('PAYOUT_NOT_FOUND', `Instant payout ${payoutId} not found.`);
  }

  return mapRow(row);
}

// ---------------------------------------------------------------------------
// listInstantPayouts
// ---------------------------------------------------------------------------

export async function listInstantPayouts(
  promoterId: string,
  deps: ServiceDeps,
): Promise<InstantPayout[]> {
  const { db } = deps;

  const rows = await db.query<InstantPayoutRow>(
    `SELECT * FROM instant_payouts WHERE promoter_id = $1 ORDER BY requested_at DESC`,
    [promoterId],
  );

  return rows.map(mapRow);
}

// ---------------------------------------------------------------------------
// cancelInstantPayout
// ---------------------------------------------------------------------------

export async function cancelInstantPayout(
  payoutId: string,
  promoterId: string,
  deps: ServiceDeps,
): Promise<InstantPayout> {
  const { db, stripe } = deps;

  const rows = await db.query<InstantPayoutRow>(
    `SELECT * FROM instant_payouts WHERE id = $1 AND promoter_id = $2`,
    [payoutId, promoterId],
  );

  const row = rows[0];
  if (!row) {
    throw new InstantPayoutError('PAYOUT_NOT_FOUND', `Instant payout ${payoutId} not found.`);
  }

  if (row.status !== 'pending') {
    throw new InstantPayoutError(
      'PAYOUT_NOT_CANCELLABLE',
      `Instant payout cannot be cancelled in status '${row.status}'.`,
    );
  }

  // If there's a stripe payout ID, cancel it in Stripe too
  if (row.stripe_payout_id) {
    try {
      await stripe.cancelPayout(row.stripe_payout_id);
    } catch (err) {
      throw new InstantPayoutError(
        'STRIPE_ERROR',
        err instanceof Error ? err.message : 'Stripe cancel failed.',
      );
    }
  }

  const updated = await db.query<InstantPayoutRow>(
    `UPDATE instant_payouts
     SET status = 'cancelled', processed_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [payoutId],
  );

  const updatedRow = updated[0];
  if (!updatedRow) {
    throw new InstantPayoutError('PAYOUT_NOT_FOUND', `Instant payout ${payoutId} not found after cancel.`);
  }

  return mapRow(updatedRow);
}
