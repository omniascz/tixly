import { rotateTicketTotpSecret, publishRotationEvent } from '../lib/totp-rotation.js';
import type {
  ResaleListing,
  CreateListingRequest,
  PurchaseListingRequest,
  ClaimResult,
  DbAdapter,
  RedisAdapter,
  EventBusAdapter,
  GopayAdapter,
  PushNotificationAdapter,
  DbRow,
} from '../types/resale';
import {
  ListingUnavailableError,
  ListingNotFoundError,
  UnauthorizedSellerError,
  ResaleNotAllowedError,
  PriceCapViolationError,
  FraudSuspectedError,
  ClaimWindowExpiredError,
  SelfPurchaseError,
  DuplicateListingError,
  TicketNotValidError,
  TicketOwnershipError,
  EventTooSoonError,
} from '../lib/resale-errors.js';
import { withTenantContext } from '@tixly/rls-multitenancy';
import { WatchlistService } from './watchlist.service.js';

// ---------------------------------------------------------------------------
// TenantContext
// ---------------------------------------------------------------------------

type TenantContext = {
  promoterId?: string;
  userId?: string;
  role: 'service' | 'admin' | 'promoter' | 'buyer';
};

// ---------------------------------------------------------------------------
// DB row shapes — used only inside this service
// ---------------------------------------------------------------------------

interface TicketRow extends DbRow {
  id: string;
  owner_id: string;
  ticket_type_id: string;
  status: string;
  original_price: string;
  totp_secret_encrypted: Buffer;
  totp_secret_iv: Buffer;
  device_binding_id: string | null;
  transfer_count: number;
}

interface EventRow extends DbRow {
  id: string;
  resale_allowed: boolean;
  date_start: string;
}

interface TicketTypeRow extends DbRow {
  id: string;
  event_id: string;
  zone: string | null;
}

interface ListingRow extends DbRow {
  id: string;
  ticket_id: string;
  seller_id: string;
  buyer_id: string | null;
  ask_price: string;
  original_price: string;
  commission_rate: string;
  status: string;
  escrow_status: string;
  escrow_gopay_id: string | null;
  listed_at: string;
  expires_at: string | null;
  reserved_until: string | null;
  sold_at: string | null;
  cancelled_at: string | null;
  payout_amount: string | null;
  payout_at: string | null;
  payout_retry_count: number;
  manual_review: boolean;
}

interface TransferLogRow extends DbRow {
  id: string;
  listing_id: string;
  old_totp_secret_encrypted: Buffer;
  old_totp_secret_iv: Buffer;
  transferred_at: string;
}

interface SellerRow extends DbRow {
  id: string;
  iban: string | null;
}

// ---------------------------------------------------------------------------
// Mapping helper
// ---------------------------------------------------------------------------

function mapListing(row: ListingRow): ResaleListing {
  return {
    id: row.id,
    ticketId: row.ticket_id,
    sellerId: row.seller_id,
    buyerId: row.buyer_id,
    askPrice: Number(row.ask_price),
    originalPrice: Number(row.original_price),
    commissionRate: Number(row.commission_rate),
    status: row.status as ResaleListing['status'],
    escrowStatus: row.escrow_status as ResaleListing['escrowStatus'],
    gopayPaymentId: row.escrow_gopay_id,
    listedAt: new Date(row.listed_at),
    expiresAt: row.expires_at ? new Date(row.expires_at) : null,
    reservedUntil: row.reserved_until ? new Date(row.reserved_until) : null,
    soldAt: row.sold_at ? new Date(row.sold_at) : null,
    cancelledAt: row.cancelled_at ? new Date(row.cancelled_at) : null,
    payoutAmount: row.payout_amount ? Number(row.payout_amount) : null,
    payoutAt: row.payout_at ? new Date(row.payout_at) : null,
    payoutRetryCount: row.payout_retry_count,
    manualReview: row.manual_review,
  };
}

const DEFAULT_COMMISSION_RATE = 0.05;
/** Claim window: 4 hours in milliseconds */
const CLAIM_WINDOW_MS = 4 * 60 * 60 * 1000;
/** Reservation window: 10 minutes in milliseconds */
const RESERVATION_WINDOW_MS = 10 * 60 * 1000;
/** Auto-delist threshold: 24 hours before event */
const AUTO_DELIST_BEFORE_MS = 24 * 60 * 60 * 1000;
/** Fraud floor: ask_price below this fraction of original_price is auto-blocked */
const FRAUD_FLOOR_RATIO = 0.5;
/**
 * EU price cap: resale price may not exceed 110 % of face value.
 * Directive (EU) 2019/771 + CZ consumer protection amendment 2023.
 * Use Math.floor to keep result in integer halíře (never rounds up above cap).
 */
const PRICE_CAP_RATIO = 1.10;

// ---------------------------------------------------------------------------

export class ResaleListingService {
  constructor(
    private readonly db: DbAdapter,
    private readonly redis: RedisAdapter,
    private readonly eventBus: EventBusAdapter,
    private readonly gopay: GopayAdapter,
    private readonly push: PushNotificationAdapter,
  ) {}

  // -------------------------------------------------------------------------
  // createListing
  // -------------------------------------------------------------------------

  async createListing(
    sellerId: string,
    req: CreateListingRequest,
    context: TenantContext = { role: 'service' },
  ): Promise<ResaleListing> {
    return withTenantContext(this.db, context, async (db) => {
      // 1. Load ticket and assert ownership
      const ticketRows = await db.query<TicketRow>(
        `SELECT t.id, t.owner_id, t.ticket_type_id, t.status, t.original_price,
                t.totp_secret_encrypted, t.totp_secret_iv, t.device_binding_id, t.transfer_count
         FROM tickets.tickets t
         WHERE t.id = $1`,
        [req.ticketId],
      );

      if (ticketRows.length === 0) {
        throw new TicketOwnershipError('Ticket not found.');
      }

      const ticket = ticketRows[0];

      if (ticket.owner_id !== sellerId) {
        throw new UnauthorizedSellerError('Ticket does not belong to this seller.');
      }

      if (ticket.status !== 'valid') {
        throw new TicketNotValidError(`Ticket status is '${ticket.status}'; only 'valid' tickets can be listed.`);
      }

      // 2. Load ticket_type → event; verify resale_allowed
      const ticketTypeRows = await db.query<TicketTypeRow>(
        `SELECT tt.id, tt.event_id, tt.zone
         FROM catalog.ticket_types tt
         WHERE tt.id = $1`,
        [ticket.ticket_type_id],
      );

      if (ticketTypeRows.length === 0) {
        throw new TicketNotValidError('Ticket type not found.');
      }

      const ticketType = ticketTypeRows[0];

      const eventRows = await db.query<EventRow>(
        `SELECT e.id, e.resale_allowed, e.date_start
         FROM catalog.events e
         WHERE e.id = $1`,
        [ticketType.event_id],
      );

      if (eventRows.length === 0 || !eventRows[0].resale_allowed) {
        throw new ResaleNotAllowedError('Resale is not allowed for this event.');
      }

      // 3. Validate ask_price against original_price loaded from DB (never from client).
      //    EU cap: max 110 % of face value (Directive 2019/771 + CZ amendment 2023).
      const originalPrice = Number(ticket.original_price);
      const priceCapHalire = Math.floor(PRICE_CAP_RATIO * originalPrice);

      if (req.askPrice > priceCapHalire) {
        throw new PriceCapViolationError(req.askPrice, priceCapHalire);
      }

      // 4. Fraud check: price floor
      if (req.askPrice < FRAUD_FLOOR_RATIO * originalPrice) {
        throw new FraudSuspectedError(req.askPrice, originalPrice);
      }

      // 5. Check for duplicate active listing (belt-and-suspenders — DB partial unique index also enforces this)
      const existingRows = await db.query<DbRow>(
        `SELECT id FROM resale.resale_listings
         WHERE ticket_id = $1 AND status IN ('active', 'reserved')
         LIMIT 1`,
        [req.ticketId],
      );

      if (existingRows.length > 0) {
        throw new DuplicateListingError('An active listing already exists for this ticket.');
      }

      // 6. Compute expires_at — 24h before event start, unless caller passed an explicit value.
      const eventStartMs = new Date(eventRows[0].date_start).getTime();
      const defaultExpiresAt = new Date(eventStartMs - AUTO_DELIST_BEFORE_MS);
      const expiresAt = req.explicitExpiresAt ?? defaultExpiresAt;

      if (expiresAt.getTime() <= Date.now()) {
        const hoursUntilEvent = Math.max(0, Math.ceil((eventStartMs - Date.now()) / (60 * 60 * 1000)));
        throw new EventTooSoonError(hoursUntilEvent);
      }

      // 7. INSERT listing + UPDATE ticket status atomically
      const listingRows = await db.transaction(async (tx) => {
        const inserted = await tx.query<ListingRow>(
          `INSERT INTO resale.resale_listings
             (ticket_id, seller_id, ask_price, original_price, commission_rate,
              status, escrow_status, listed_at, expires_at)
           VALUES ($1, $2, $3, $4, $5, 'active', 'none', NOW(), $6)
           RETURNING *`,
          [req.ticketId, sellerId, req.askPrice, originalPrice, DEFAULT_COMMISSION_RATE, expiresAt.toISOString()],
        );

        await tx.query(
          `UPDATE tickets.tickets SET status = 'resale_listed', updated_at = NOW() WHERE id = $1`,
          [req.ticketId],
        );

        return inserted;
      });

      const listing = mapListing(listingRows[0]);

      await this.eventBus.publish('resale.listing.created', {
        listingId: listing.id,
        ticketId: listing.ticketId,
        sellerId,
        askPrice: listing.askPrice,
        eventId: ticketType.event_id,
        zone: ticketType.zone,
      });

      // Feature #48 — notify watchlist subscribers (fire-and-forget).
      // Failures must NOT block listing creation. The actual email/push
      // delivery is handled by a separate consumer subscribed to the
      // `watchlist.match` event published by notifyMatchingWatchers.
      const watchlistService = new WatchlistService(this.db, this.redis, this.eventBus);
      void watchlistService
        .notifyMatchingWatchers(listing, ticketType.event_id, ticketType.zone)
        .catch((err) => console.error('[watchlist] notify failed', err));

      return listing;
    });
  }

  // -------------------------------------------------------------------------
  // createOneClickListing — Feature #46
  // -------------------------------------------------------------------------

  /**
   * 1-click resale listing from "Moje vstupenky":
   *  - ask price auto-set to the ticket's original purchase price
   *  - expires 24h before event start
   *  - reuses createListing internally (no duplicated validation/escrow logic)
   *
   * @throws TicketOwnershipError   — caller is not the ticket owner
   * @throws ResaleNotAllowedError  — event doesn't allow resale
   * @throws TicketNotValidError    — ticket is refunded/cancelled/used
   * @throws DuplicateListingError  — a listing for this ticket already exists
   * @throws PriceCapViolationError — original price exceeds event cap (edge case)
   * @throws EventTooSoonError      — event is less than 24h away (can't list)
   */
  async createOneClickListing(
    ticketId: string,
    sellerId: string,
  ): Promise<ResaleListing> {
    return withTenantContext(this.db, { role: 'buyer', userId: sellerId }, async (db) => {
      // Pre-flight: load ticket → ticket_type → event in order to compute
      // askPrice (= original_price) and expiresAt (= event.date_start - 24h)
      // up-front. The actual validation (ownership/status/resale_allowed/
      // duplicate/fraud/cap) is delegated to createListing below, so this
      // method stays thin and does not duplicate that logic.
      const ticketRows = await db.query<TicketRow>(
        `SELECT t.id, t.owner_id, t.ticket_type_id, t.status, t.original_price,
                t.totp_secret_encrypted, t.totp_secret_iv, t.device_binding_id, t.transfer_count
         FROM tickets.tickets t
         WHERE t.id = $1`,
        [ticketId],
      );

      if (ticketRows.length === 0) {
        throw new TicketOwnershipError('Ticket not found.');
      }

      const ticket = ticketRows[0];

      // Fast-fail ownership so we don't leak event timing to non-owners
      if (ticket.owner_id !== sellerId) {
        throw new TicketOwnershipError('Ticket does not belong to this seller.');
      }

      const ticketTypeRows = await db.query<TicketTypeRow>(
        `SELECT tt.id, tt.event_id, tt.zone
         FROM catalog.ticket_types tt
         WHERE tt.id = $1`,
        [ticket.ticket_type_id],
      );

      if (ticketTypeRows.length === 0) {
        throw new TicketNotValidError('Ticket type not found.');
      }

      const eventRows = await db.query<EventRow>(
        `SELECT e.id, e.resale_allowed, e.date_start
         FROM catalog.events e
         WHERE e.id = $1`,
        [ticketTypeRows[0].event_id],
      );

      if (eventRows.length === 0) {
        throw new ResaleNotAllowedError('Event not found for this ticket.');
      }

      const eventStartMs = new Date(eventRows[0].date_start).getTime();
      const expiresAt = new Date(eventStartMs - AUTO_DELIST_BEFORE_MS);

      if (expiresAt.getTime() <= Date.now()) {
        const hoursUntilEvent = Math.max(0, Math.ceil((eventStartMs - Date.now()) / (60 * 60 * 1000)));
        throw new EventTooSoonError(hoursUntilEvent);
      }

      const askPrice = Number(ticket.original_price);

      // Delegate to createListing — it re-runs all validation (ownership,
      // status, resale_allowed, duplicate, price cap, fraud floor) and owns
      // the atomic INSERT + ticket.status UPDATE + event publish.
      return this.createListing(
        sellerId,
        { ticketId, askPrice, explicitExpiresAt: expiresAt },
        { role: 'buyer', userId: sellerId },
      );
    });
  }

  // -------------------------------------------------------------------------
  // cancelListing
  // -------------------------------------------------------------------------

  async cancelListing(
    listingId: string,
    sellerId: string,
    context: TenantContext = { role: 'service' },
  ): Promise<void> {
    return withTenantContext(this.db, context, async (db) => {
      const rows = await db.query<ListingRow>(
        `SELECT * FROM resale.resale_listings WHERE id = $1`,
        [listingId],
      );

      if (rows.length === 0) {
        throw new ListingNotFoundError(`Listing ${listingId} not found.`);
      }

      const listing = rows[0];

      if (listing.seller_id !== sellerId) {
        throw new UnauthorizedSellerError('Only the seller can cancel this listing.');
      }

      if (listing.status !== 'active') {
        throw new ListingUnavailableError(
          `Cannot cancel listing in status '${listing.status}'. Only active listings can be cancelled.`,
        );
      }

      await db.transaction(async (tx) => {
        await tx.query(
          `UPDATE resale.resale_listings
           SET status = 'cancelled', cancelled_at = NOW()
           WHERE id = $1`,
          [listingId],
        );

        await tx.query(
          `UPDATE tickets.tickets SET status = 'valid', updated_at = NOW() WHERE id = $1`,
          [listing.ticket_id],
        );
      });

      await this.eventBus.publish('resale.listing.cancelled', { listingId, sellerId });
    });
  }

  // -------------------------------------------------------------------------
  // purchaseListing
  // -------------------------------------------------------------------------

  async purchaseListing(
    buyerId: string,
    req: PurchaseListingRequest,
    context: TenantContext = { role: 'service' },
  ): Promise<{ listing: ResaleListing; gopayRedirectUrl: string }> {
    return withTenantContext(this.db, context, async (db) => {
      // Atomically reserve the listing with a single UPDATE.
      // Affected rows = 0 means it was already reserved/sold by another request (race condition).
      const reservedUntil = new Date(Date.now() + RESERVATION_WINDOW_MS);

      const affected = await db.query<ListingRow>(
        `UPDATE resale.resale_listings
         SET status = 'reserved',
             buyer_id = $1,
             reserved_until = $2
         WHERE id = $3 AND status = 'active'
         RETURNING *`,
        [buyerId, reservedUntil.toISOString(), req.listingId],
      );

      if (affected.length === 0) {
        throw new ListingUnavailableError('Listing is no longer available. Please try another one.');
      }

      const listing = mapListing(affected[0]);

      // Validate buyer ≠ seller
      if (listing.sellerId === buyerId) {
        // Roll back the reservation before throwing
        await db.query(
          `UPDATE resale.resale_listings
           SET status = 'active', buyer_id = NULL, reserved_until = NULL
           WHERE id = $1`,
          [req.listingId],
        );
        throw new SelfPurchaseError('You cannot purchase your own listing.');
      }

      // Create GoPay preauthorization (money held on card, NOT captured yet)
      // TODO(multi-currency): read currency from event via listing→ticket→event.currency
      const gopayResult = await this.gopay.preauthorize({
        amount: listing.askPrice,
        currency: process.env.DEFAULT_CURRENCY ?? 'CZK',
        orderId: listing.id,
        description: `Resale ticket — listing ${listing.id}`,
        returnUrl: `${process.env.APP_BASE_URL}/resale/${listing.id}/payment-return`,
      });

      await db.query(
        `UPDATE resale.resale_listings
         SET escrow_gopay_id = $1
         WHERE id = $2`,
        [gopayResult.paymentId, listing.id],
      );

      await this.eventBus.publish('resale.purchase.initiated', {
        listingId: listing.id,
        buyerId,
        gopayPaymentId: gopayResult.paymentId,
      });

      return {
        listing: { ...listing, gopayPaymentId: gopayResult.paymentId },
        gopayRedirectUrl: gopayResult.redirectUrl,
      };
    });
  }

  // -------------------------------------------------------------------------
  // handleGopayCallback
  // -------------------------------------------------------------------------

  async handleGopayCallback(
    gopayPaymentId: string,
    status: string,
    context: TenantContext = { role: 'service' },
  ): Promise<void> {
    return withTenantContext(this.db, context, async (db) => {
      const rows = await db.query<ListingRow>(
        `SELECT * FROM resale.resale_listings WHERE escrow_gopay_id = $1`,
        [gopayPaymentId],
      );

      if (rows.length === 0) {
        // Unknown payment — log and ignore (GoPay retries on non-200, we always return 200)
        console.warn(`[gopay-callback] No listing found for payment ${gopayPaymentId}`);
        return;
      }

      const listing = rows[0];

      if (status === 'AUTHORIZED') {
        await this.handleGopayAuthorized(listing, db);
      } else if (status === 'CANCELLED' || status === 'FAILED') {
        await this.handleGopayFailed(listing, status, db);
      }
      // Any other status (TIMEOUTED, etc.) is silently ignored — GoPay will retry
    });
  }

  /**
   * AUTHORIZED: atomically rotate TOTP secret and mark ticket as transferred.
   * This is the critical section — old secret must be overwritten in the same
   * transaction that marks the listing as sold, so there is never a moment
   * where both seller's cached secret and buyer's new secret are "valid".
   */
  private async handleGopayAuthorized(listing: ListingRow, db: DbAdapter): Promise<void> {
    // Feature #47: rotace TOTP, převod vlastnictví a označení listingu jako
    // sold (escrow=held) musí proběhnout atomicky v jedné transakci. Po commit
    // publikujeme `ticket.totp_rotated` (fire-and-forget) — wallet pass push
    // konzument (Feature #41) si na základě eventu invaliduje cached QR.
    //
    // POZOR: escrow zůstává ve stavu 'held'. K uvolnění (released) dojde až
    // při skenu u brány přes releaseEscrowOnEntry — viz lib/escrow-release.ts.
    let rotatedAt: Date | null = null;

    await db.transaction(async (tx) => {
      // 1. Atomická TOTP rotace + audit log (helper zajišťuje FOR UPDATE,
      //    INSERT do ticket_transfer_log s old + new + reason + actor).
      //    Buyer nemůže být null v authorized callbacku — defenzivně to
      //    ošetříme pádem.
      if (!listing.buyer_id) {
        throw new Error(`Listing ${listing.id} has no buyer_id at AUTHORIZED time`);
      }

      const rotation = await rotateTicketTotpSecret(
        listing.ticket_id,
        'resale_purchase',
        listing.buyer_id,
        tx,
        listing.id,
      );
      rotatedAt = rotation.rotatedAt;

      // 2. Převod vlastnictví + status 'transferred' (kupující musí ještě
      //    claimnout, aby přešlo zpět na 'valid'; toto chování zachováváme).
      await tx.query(
        `UPDATE tickets.tickets
         SET owner_id  = $1,
             status    = 'transferred',
             updated_at = NOW()
         WHERE id = $2`,
        [listing.buyer_id, listing.ticket_id],
      );

      // 3. Označ listing jako sold s escrow ve stavu 'held'.
      //    'released' bude až při skenu u brány (releaseEscrowOnEntry).
      await tx.query(
        `UPDATE resale.resale_listings
         SET status = 'sold',
             escrow_status = 'held',
             sold_at = NOW()
         WHERE id = $1`,
        [listing.id],
      );
    });

    // Po commitu DB transakce — Kafka event pro wallet pass push.
    if (rotatedAt) {
      await publishRotationEvent(this.eventBus, listing.ticket_id, rotatedAt, 'resale_purchase');
    }

    await this.eventBus.publish('resale.ticket.transferred', {
      listingId: listing.id,
      ticketId: listing.ticket_id,
      sellerId: listing.seller_id,
      buyerId: listing.buyer_id,
    });

    // Push notifications — fire-and-forget, don't fail the whole flow
    await Promise.allSettled([
      this.push.send(listing.seller_id, {
        title: 'Your ticket has been sold',
        body: 'Your ticket has been successfully transferred to the buyer.',
        data: { listingId: listing.id },
      }),
      listing.buyer_id
        ? this.push.send(listing.buyer_id, {
            title: 'Claim your ticket',
            body: 'Payment received. Open the app and activate your ticket (you have 4 hours).',
            data: { ticketId: listing.ticket_id, action: 'claim' },
          })
        : Promise.resolve(),
    ]);
  }

  private async handleGopayFailed(listing: ListingRow, reason: string, db: DbAdapter): Promise<void> {
    // Reset listing to active so other buyers can purchase it
    await db.query(
      `UPDATE resale.resale_listings
       SET status = 'active',
           buyer_id = NULL,
           reserved_until = NULL,
           escrow_gopay_id = NULL
       WHERE id = $1`,
      [listing.id],
    );

    await this.eventBus.publish('resale.purchase.failed', {
      listingId: listing.id,
      buyerId: listing.buyer_id,
      reason,
    });
  }

  // -------------------------------------------------------------------------
  // claimTicket
  // -------------------------------------------------------------------------

  async claimTicket(
    ticketId: string,
    buyerId: string,
    context: TenantContext = { role: 'service' },
  ): Promise<ClaimResult> {
    return withTenantContext(this.db, context, async (db) => {
      const ticketRows = await db.query<TicketRow>(
        `SELECT t.id, t.owner_id, t.status, t.totp_secret_encrypted, t.totp_secret_iv,
                t.device_binding_id, t.claimed_at
         FROM tickets.tickets t
         WHERE t.id = $1`,
        [ticketId],
      );

      if (ticketRows.length === 0) {
        return { success: false, ticketId, newQRAvailable: false, errorCode: 'TICKET_NOT_FOUND' };
      }

      const ticket = ticketRows[0];

      if (ticket.owner_id !== buyerId) {
        return { success: false, ticketId, newQRAvailable: false, errorCode: 'UNAUTHORIZED' };
      }

      if (ticket.status !== 'transferred') {
        if ((ticket as unknown as Record<string, unknown>)['claimed_at']) {
          return { success: false, ticketId, newQRAvailable: true, errorCode: 'ALREADY_CLAIMED' };
        }
        return { success: false, ticketId, newQRAvailable: false, errorCode: 'TICKET_NOT_FOUND' };
      }

      // Load the corresponding listing to check claim window and get gopay_id
      const listingRows = await db.query<ListingRow>(
        `SELECT rl.*, rl.sold_at
         FROM resale.resale_listings rl
         WHERE rl.ticket_id = $1 AND rl.status = 'sold' AND rl.escrow_status = 'held'
         ORDER BY rl.sold_at DESC
         LIMIT 1`,
        [ticketId],
      );

      if (listingRows.length === 0) {
        return { success: false, ticketId, newQRAvailable: false, errorCode: 'TICKET_NOT_FOUND' };
      }

      const listing = listingRows[0];

      // Verify claim window: sold_at + 4 hours
      const claimDeadline = new Date(new Date(listing.sold_at!).getTime() + CLAIM_WINDOW_MS);
      if (new Date() > claimDeadline) {
        throw new ClaimWindowExpiredError('The 4-hour claim window has expired. The listing has been reset.');
      }

      // Capture payment — buyer has confirmed receipt, money is now charged
      await this.gopay.capture(listing.escrow_gopay_id!);

      // Update ticket and listing status
      await db.transaction(async (tx) => {
        await tx.query(
          `UPDATE tickets.tickets
           SET status = 'valid',
               claimed_at = NOW(),
               updated_at = NOW()
           WHERE id = $1`,
          [ticketId],
        );

        await tx.query(
          `UPDATE resale.resale_listings
           SET escrow_status = 'captured'
           WHERE id = $1`,
          [listing.id],
        );
      });

      await this.eventBus.publish('resale.ticket.claimed', {
        listingId: listing.id,
        ticketId,
        buyerId,
      });

      return { success: true, ticketId, newQRAvailable: true };
    });
  }

  // -------------------------------------------------------------------------
  // handleClaimTimeout
  // -------------------------------------------------------------------------

  /**
   * Called by the scheduler when the 4-hour claim window expires without a claim.
   * Rolls back the TOTP secret from ticket_transfer_log, voids the GoPay
   * preauthorization (no money taken), and returns the listing to active.
   */
  async handleClaimTimeout(
    listingId: string,
    context: TenantContext = { role: 'service' },
  ): Promise<void> {
    return withTenantContext(this.db, context, async (db) => {
      const rows = await db.query<ListingRow>(
        `SELECT * FROM resale.resale_listings WHERE id = $1`,
        [listingId],
      );

      if (rows.length === 0) {
        throw new ListingNotFoundError(`Listing ${listingId} not found.`);
      }

      const listing = rows[0];

      if (listing.escrow_status !== 'held') {
        // Already resolved (captured / voided by another process)
        return;
      }

      const claimDeadline = new Date(new Date(listing.sold_at!).getTime() + CLAIM_WINDOW_MS);
      if (new Date() <= claimDeadline) {
        // Window has not yet expired — scheduler fired too early
        return;
      }

      // Load backup secret from transfer log
      const logRows = await db.query<TransferLogRow>(
        `SELECT * FROM tickets.ticket_transfer_log
         WHERE listing_id = $1
         ORDER BY transferred_at DESC
         LIMIT 1`,
        [listingId],
      );

      if (logRows.length === 0) {
        throw new Error(`No transfer log found for listing ${listingId} — cannot rollback TOTP secret`);
      }

      const log = logRows[0];

      // Void GoPay authorization before touching DB — if this throws, DB stays unchanged
      await this.gopay.voidAuthorization(listing.escrow_gopay_id!);

      // Atomic rollback: restore original TOTP secret + return ticket to seller + reset listing
      await db.transaction(async (tx) => {
        await tx.query(
          `UPDATE tickets.tickets
           SET totp_secret_encrypted = $1,
               totp_secret_iv = $2,
               owner_id = $3,
               status = 'resale_listed',
               updated_at = NOW()
           WHERE id = $4`,
          [log.old_totp_secret_encrypted, log.old_totp_secret_iv, listing.seller_id, listing.ticket_id],
        );

        await tx.query(
          `UPDATE resale.resale_listings
           SET status = 'active',
               buyer_id = NULL,
               reserved_until = NULL,
               sold_at = NULL,
               escrow_status = 'voided'
           WHERE id = $1`,
          [listingId],
        );
      });

      await Promise.allSettled([
        this.push.send(listing.seller_id, {
          title: 'Ticket transfer expired',
          body: 'The buyer did not claim the ticket in time. Your ticket is listed for sale again.',
          data: { listingId },
        }),
        listing.buyer_id
          ? this.push.send(listing.buyer_id, {
              title: 'Payment cancelled',
              body: 'You did not claim the ticket in time. No money was charged.',
              data: { listingId },
            })
          : Promise.resolve(),
      ]);

      await this.eventBus.publish('resale.claim.timeout', {
        listingId,
        ticketId: listing.ticket_id,
        sellerId: listing.seller_id,
        buyerId: listing.buyer_id,
      });
    });
  }

  // -------------------------------------------------------------------------
  // autoDelistExpired
  // -------------------------------------------------------------------------

  /**
   * Delists all active listings whose event starts within 24 hours.
   * Run every minute by the scheduler.
   */
  async autoDelistExpired(
    context: TenantContext = { role: 'service' },
  ): Promise<number> {
    return withTenantContext(this.db, context, async (db) => {
      const thresholdMs = AUTO_DELIST_BEFORE_MS;

      // Find active listings where the event starts in less than 24 hours
      const expiredRows = await db.query<ListingRow & { ticket_id: string }>(
        `SELECT rl.id, rl.ticket_id
         FROM resale.resale_listings rl
         JOIN catalog.ticket_types tt ON tt.id = (
             SELECT ticket_type_id FROM tickets.tickets WHERE id = rl.ticket_id
         )
         JOIN catalog.events e ON e.id = tt.event_id
         WHERE rl.status = 'active'
           AND e.date_start <= NOW() + ($1 || ' milliseconds')::INTERVAL`,
        [thresholdMs.toString()],
      );

      if (expiredRows.length === 0) return 0;

      const ids = expiredRows.map((r) => r.id);
      const ticketIds = expiredRows.map((r) => r.ticket_id);

      await db.transaction(async (tx) => {
        await tx.query(
          `UPDATE resale.resale_listings
           SET status = 'expired'
           WHERE id = ANY($1::uuid[])`,
          [ids],
        );

        await tx.query(
          `UPDATE tickets.tickets
           SET status = 'valid', updated_at = NOW()
           WHERE id = ANY($1::uuid[])`,
          [ticketIds],
        );
      });

      await this.eventBus.publish('resale.listings.auto_delisted', { count: ids.length, listingIds: ids });

      return ids.length;
    });
  }

  // -------------------------------------------------------------------------
  // Internal: load a listing or throw
  // -------------------------------------------------------------------------

  async getListingOrThrow(
    listingId: string,
    context: TenantContext = { role: 'service' },
  ): Promise<ResaleListing> {
    return withTenantContext(this.db, context, async (db) => {
      const rows = await db.query<ListingRow>(
        `SELECT * FROM resale.resale_listings WHERE id = $1`,
        [listingId],
      );

      if (rows.length === 0) {
        throw new ListingNotFoundError(`Listing ${listingId} not found.`);
      }

      return mapListing(rows[0]);
    });
  }
}

// ---------------------------------------------------------------------------
// Feature #46 — free-function shim for route handlers / tests
// ---------------------------------------------------------------------------

/**
 * Minimal dependency bag for stand-alone resale service functions.
 * Thin wrapper around the full ServiceContainer — only the adapters needed
 * by createOneClickListing are required.
 */
export interface ServiceDeps {
  db: DbAdapter;
  redis: RedisAdapter;
  eventBus: EventBusAdapter;
  gopay: GopayAdapter;
  push: PushNotificationAdapter;
}

/**
 * 1-click resale listing from "Moje vstupenky" — free-function entry point.
 * Instantiates a ResaleListingService from the provided deps and delegates
 * to its createOneClickListing method.
 */
export async function createOneClickListing(
  ticketId: string,
  sellerId: string,
  deps: ServiceDeps,
): Promise<ResaleListing> {
  const service = new ResaleListingService(
    deps.db,
    deps.redis,
    deps.eventBus,
    deps.gopay,
    deps.push,
  );
  return service.createOneClickListing(ticketId, sellerId);
}
