// GiftVoucherService — core business logic for gift vouchers.
// All monetary values in haléře (CZK). This service does NOT process payments —
// payment is handled upstream by the order service; this service only
// manages voucher state and value reservation.

import type {
  GiftVoucher,
  GiftVoucherType,
  GiftVoucherStatus,
  RedeemVoucherRequest,
  RedeemVoucherResult,
} from '../types/gift-voucher.types';
import {
  VoucherNotFoundError,
  VoucherUnauthorizedError,
  VoucherCancelledError,
} from '../types/gift-voucher.types';
import {
  generateVoucherCode,
  validateVoucherApplicability,
  calculateAppliedAmount,
} from '../lib/voucher-generator';

// ---------------------------------------------------------------------------
// DB adapter interface — injected; easy to mock in tests
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Tx = any;

export interface VoucherDbAdapter {
  findVoucherByCode(code: string): Promise<GiftVoucher | null>;
  findVoucherById(id: string): Promise<GiftVoucher | null>;
  createVoucher(data: Omit<GiftVoucher, 'id' | 'issued_at'>): Promise<GiftVoucher>;
  updateVoucher(id: string, data: Partial<GiftVoucher>, tx?: Tx): Promise<GiftVoucher>;
  findExpiredVouchers(now: Date): Promise<GiftVoucher[]>;
  listVouchersByPurchaser(userId: string): Promise<GiftVoucher[]>;
  withTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
}

// ---------------------------------------------------------------------------
// Purchase options
// ---------------------------------------------------------------------------

export interface PurchaseVoucherOptions {
  type: GiftVoucherType;
  /** Haléře. For ticket type this is ignored (ticket face value is used instead). */
  value: number;
  recipientEmail?: string;
  recipientName?: string;
  applicableEventId?: string;
  applicableTicketTypeId?: string;
  /** Defaults to now + 12 months */
  validUntil?: Date;
  personalMessage?: string;
  /** Required for ticket type — face value of the ticket at issuance time (haléře) */
  ticketFaceValue?: number;
  /** ISO 4217 currency code — defaults to DEFAULT_CURRENCY env or 'CZK' */
  currency?: string;
}

// ---------------------------------------------------------------------------
// GiftVoucherService
// ---------------------------------------------------------------------------

const MAX_CODE_ATTEMPTS = 5;
const VALIDITY_MONTHS = 12;

export class GiftVoucherService {
  // -------------------------------------------------------------------------
  // purchaseVoucher
  // -------------------------------------------------------------------------

  /**
   * Creates and persists a new gift voucher.
   * Generates a unique code (up to MAX_CODE_ATTEMPTS retries on collision).
   * Does NOT charge the purchaser — payment is handled by the calling order flow.
   */
  async purchaseVoucher(
    purchaserUserId: string,
    options: PurchaseVoucherOptions,
    db: VoucherDbAdapter,
  ): Promise<GiftVoucher> {
    const now = new Date();

    const validUntil =
      options.validUntil ??
      new Date(
        Date.UTC(
          now.getUTCFullYear(),
          now.getUTCMonth() + VALIDITY_MONTHS,
          now.getUTCDate(),
          now.getUTCHours(),
          now.getUTCMinutes(),
          now.getUTCSeconds(),
        ),
      );

    // Determine effective value
    const effectiveValue =
      options.type === 'ticket' && options.ticketFaceValue !== undefined
        ? options.ticketFaceValue
        : options.value;

    // Generate unique code
    let code: string | null = null;
    for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
      const candidate = generateVoucherCode();
      const existing = await db.findVoucherByCode(candidate);
      if (!existing) {
        code = candidate;
        break;
      }
    }

    if (code === null) {
      throw new Error('Failed to generate a unique voucher code after maximum attempts.');
    }

    const voucherData: Omit<GiftVoucher, 'id' | 'issued_at'> = {
      code,
      type: options.type,
      status: 'issued',
      initial_value: effectiveValue,
      remaining_value: effectiveValue,
      currency: options.currency ?? process.env.DEFAULT_CURRENCY ?? 'CZK',
      purchaser_user_id: purchaserUserId,
      recipient_email: options.recipientEmail ?? null,
      recipient_name: options.recipientName ?? null,
      applicable_event_id: options.applicableEventId ?? null,
      applicable_ticket_type_id: options.applicableTicketTypeId ?? null,
      valid_until: validUntil,
      sent_at: null,
      redeemed_at: null,
      redemption_order_id: null,
      personal_message: options.personalMessage ?? null,
    };

    return db.createVoucher(voucherData);
  }

  // -------------------------------------------------------------------------
  // sendVoucher
  // -------------------------------------------------------------------------

  /**
   * Marks the voucher as sent (issued → sent).
   * The actual e-mail delivery is handled by the email service — this method
   * only advances the voucher's status so the system has an audit trail.
   */
  async sendVoucher(voucherId: string, userId: string, db: VoucherDbAdapter): Promise<GiftVoucher> {
    const voucher = await db.findVoucherById(voucherId);

    if (!voucher) {
      throw new VoucherNotFoundError(`Voucher ${voucherId} not found.`);
    }

    if (voucher.purchaser_user_id !== userId) {
      throw new VoucherUnauthorizedError('Only the purchaser can mark this voucher as sent.');
    }

    // Allow re-sending (sent → sent) so the purchaser can resend without error
    if (voucher.status !== 'issued' && voucher.status !== 'sent') {
      throw new VoucherCancelledError(
        `Voucher ${voucherId} cannot be sent — current status: ${voucher.status}.`,
      );
    }

    return db.updateVoucher(voucherId, {
      status: 'sent',
      sent_at: voucher.sent_at ?? new Date(),
    });
  }

  // -------------------------------------------------------------------------
  // redeemVoucher
  // -------------------------------------------------------------------------

  /**
   * Atomically reserves voucher value for an order.
   *
   * Flow:
   *   1. Load voucher by code.
   *   2. Validate applicability (expiry, status, item match).
   *   3. Calculate applied_amount = min(remaining_value, order_total).
   *   4. Within a transaction (SELECT FOR UPDATE equivalent via withTransaction):
   *        - Decrement remaining_value.
   *        - If remaining_value reaches 0 → status = 'redeemed'.
   *   5. Return RedeemVoucherResult.
   *
   * IMPORTANT: This method does NOT create an order. The order service must
   * call this, record the result, and create its own order row.
   */
  async redeemVoucher(request: RedeemVoucherRequest, db: VoucherDbAdapter): Promise<RedeemVoucherResult> {
    const voucher = await db.findVoucherByCode(request.code);

    if (!voucher) {
      throw new VoucherNotFoundError(`Voucher with code ${request.code} not found.`);
    }

    const now = new Date();
    validateVoucherApplicability(voucher, request, now);

    const orderTotal = request.order_items.reduce(
      (sum, item) => sum + item.unit_price * item.quantity,
      0,
    );
    const appliedAmount = calculateAppliedAmount(voucher, orderTotal);

    const updatedVoucher = await db.withTransaction(async (tx: Tx) => {
      // Re-fetch inside transaction to get a row-level lock (SELECT FOR UPDATE).
      // The adapter implementation is expected to issue SELECT ... FOR UPDATE.
      const locked = await db.findVoucherByCode(request.code);

      if (!locked) {
        throw new VoucherNotFoundError(`Voucher ${request.code} disappeared inside transaction.`);
      }

      // Re-validate inside the lock to guard against concurrent redemptions
      validateVoucherApplicability(locked, request, now);

      const newRemaining = locked.remaining_value - appliedAmount;
      const fullyRedeemed = newRemaining === 0;

      const updates: Partial<GiftVoucher> = {
        remaining_value: newRemaining,
        ...(fullyRedeemed
          ? {
              status: 'redeemed' as GiftVoucherStatus,
              redeemed_at: now,
            }
          : {}),
      };

      return db.updateVoucher(locked.id, updates, tx);
    });

    const fullyRedeemed = updatedVoucher.remaining_value === 0;

    return {
      voucher_id: updatedVoucher.id,
      code: updatedVoucher.code,
      applied_amount: appliedAmount,
      remaining_value: updatedVoucher.remaining_value,
      fully_redeemed: fullyRedeemed,
      new_status: updatedVoucher.status,
    };
  }

  // -------------------------------------------------------------------------
  // cancelVoucher
  // -------------------------------------------------------------------------

  /**
   * Cancels an issued or sent voucher.
   * Returns the remaining_value so the caller can initiate a refund if needed.
   * Redeemed or already-cancelled vouchers cannot be cancelled.
   */
  async cancelVoucher(voucherId: string, requesterId: string, db: VoucherDbAdapter): Promise<void> {
    const voucher = await db.findVoucherById(voucherId);

    if (!voucher) {
      throw new VoucherNotFoundError(`Voucher ${voucherId} not found.`);
    }

    if (voucher.purchaser_user_id !== requesterId) {
      throw new VoucherUnauthorizedError('Only the purchaser can cancel this voucher.');
    }

    if (voucher.status !== 'issued' && voucher.status !== 'sent') {
      throw new VoucherCancelledError(
        `Voucher ${voucherId} cannot be cancelled — current status: ${voucher.status}.`,
      );
    }

    await db.updateVoucher(voucherId, { status: 'cancelled' });
  }

  // -------------------------------------------------------------------------
  // expireVouchers
  // -------------------------------------------------------------------------

  /**
   * Batch job: marks all past-expiry vouchers as 'expired'.
   * Designed to be called once per day (e.g. 02:00 cron).
   * Returns the number of vouchers expired.
   */
  async expireVouchers(db: VoucherDbAdapter): Promise<number> {
    const now = new Date();
    const expired = await db.findExpiredVouchers(now);

    if (expired.length === 0) return 0;

    await Promise.all(
      expired.map((v) => db.updateVoucher(v.id, { status: 'expired' })),
    );

    return expired.length;
  }

  // -------------------------------------------------------------------------
  // listMyVouchers
  // -------------------------------------------------------------------------

  async listMyVouchers(userId: string, db: VoucherDbAdapter): Promise<GiftVoucher[]> {
    return db.listVouchersByPurchaser(userId);
  }
}
