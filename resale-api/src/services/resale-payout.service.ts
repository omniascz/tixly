import type {
  DbAdapter,
  EventBusAdapter,
  GopayAdapter,
  DbRow,
} from '../types/resale';

interface PayoutListingRow extends DbRow {
  id: string;
  seller_id: string;
  ask_price: string;
  commission_rate: string;
  escrow_gopay_id: string;
  payout_retry_count: number;
  manual_review: boolean;
  event_date_end: string;
}

interface SellerRow extends DbRow {
  id: string;
  iban: string | null;
}

const MAX_PAYOUT_RETRIES = 3;

/**
 * Handles deferred seller payouts.
 * Payouts run 24 h after the event ends to protect against chargebacks.
 * Commission is deducted at payout time (not at purchase time).
 */
export class ResalePayoutService {
  constructor(
    private readonly db: DbAdapter,
    private readonly eventBus: EventBusAdapter,
    private readonly gopay: GopayAdapter,
  ) {}

  /**
   * Finds all captured listings where:
   *   - event ended more than 24 hours ago
   *   - escrow_status = 'captured'
   *   - payout_status = 'pending'  (column added in migration)
   *   - payout_retry_count < MAX_PAYOUT_RETRIES
   *   - manual_review = false
   *
   * Runs once per day at 06:00 via cron.
   */
  async processPendingPayouts(): Promise<void> {
    const pendingRows = await this.db.query<PayoutListingRow>(
      `SELECT rl.id,
              rl.seller_id,
              rl.ask_price,
              rl.commission_rate,
              rl.escrow_gopay_id,
              rl.payout_retry_count,
              rl.manual_review,
              e.date_end AS event_date_end
       FROM resale.resale_listings rl
       JOIN catalog.ticket_types tt ON tt.id = (
           SELECT ticket_type_id FROM tickets.tickets WHERE id = rl.ticket_id
       )
       JOIN catalog.events e ON e.id = tt.event_id
       WHERE rl.escrow_status = 'captured'
         AND rl.payout_status = 'pending'
         AND rl.manual_review = FALSE
         AND rl.payout_retry_count < $1
         AND e.date_end IS NOT NULL
         AND e.date_end < NOW() - INTERVAL '24 hours'`,
      [MAX_PAYOUT_RETRIES],
    );

    for (const row of pendingRows) {
      await this.processOnePayout(row);
    }
  }

  private async processOnePayout(row: PayoutListingRow): Promise<void> {
    // Load seller IBAN — stored in identity schema, accessed cross-service via API or denormalized column
    const sellerRows = await this.db.query<SellerRow>(
      `SELECT id, iban FROM identity.users WHERE id = $1`,
      [row.seller_id],
    );

    const sellerIban = sellerRows[0]?.iban ?? null;

    if (!sellerIban) {
      console.warn(`[payout] Seller ${row.seller_id} has no IBAN — flagging for manual review`);
      await this.db.query(
        `UPDATE resale.resale_listings SET manual_review = TRUE WHERE id = $1`,
        [row.id],
      );
      return;
    }

    // All monetary values are INTEGER haléře (1 Kč = 100 haléře).
    // commission_rate is stored as a decimal fraction (e.g. 0.05 = 5%).
    // Math.round ensures the result stays an integer even if askPrice is odd.
    const askPrice = Number(row.ask_price);             // INTEGER haléře
    const commissionRate = Number(row.commission_rate); // decimal fraction, e.g. 0.05
    const commission = Math.round(askPrice * commissionRate); // INTEGER haléře
    // Payout = ask_price − commission (all integers)
    const payoutAmount = askPrice - commission;         // INTEGER haléře

    try {
      await this.gopay.payout({
        paymentId: row.escrow_gopay_id,
        iban: sellerIban,
        amount: payoutAmount,
      });

      await this.db.query(
        `UPDATE resale.resale_listings
         SET escrow_status = 'released',
             payout_status = 'completed',
             payout_amount = $1,
             payout_at = NOW()
         WHERE id = $2`,
        [payoutAmount, row.id],
      );

      await this.eventBus.publish('resale.payout.completed', {
        listingId: row.id,
        sellerId: row.seller_id,
        payoutAmount,
      });
    } catch (err) {
      const newRetryCount = row.payout_retry_count + 1;
      const shouldFlagForReview = newRetryCount >= MAX_PAYOUT_RETRIES;

      await this.db.query(
        `UPDATE resale.resale_listings
         SET payout_retry_count = $1,
             manual_review = $2,
             payout_status = CASE WHEN $2 THEN 'failed' ELSE 'pending' END
         WHERE id = $3`,
        [newRetryCount, shouldFlagForReview, row.id],
      );

      if (shouldFlagForReview) {
        console.error(
          `[payout] Listing ${row.id} failed ${MAX_PAYOUT_RETRIES} payout attempts — flagged for manual review`,
          err,
        );
        await this.eventBus.publish('resale.payout.manual_review_required', {
          listingId: row.id,
          sellerId: row.seller_id,
          retryCount: newRetryCount,
        });
      } else {
        console.warn(`[payout] Payout for listing ${row.id} failed (attempt ${newRetryCount})`, err);
      }
    }
  }
}
