import {
  SeasonPass,
  SeasonPassType,
  SeasonPassKind,
  BillingCycle,
  PassBenefits,
  PassUsage,
  PassTicket,
  CreateSeasonPassRequest,
  SeasonPassStatus,
} from '../types/season-pass';

// =============================================================================
// Adapter interfaces — all external dependencies injected for testability
// =============================================================================

export interface DBAdapter {
  getPassType(passTypeId: string): Promise<SeasonPassType | null>;
  listPassTypes(organizerId: string): Promise<SeasonPassType[]>;
  insertPassType(passType: Omit<SeasonPassType, 'id'>): Promise<SeasonPassType>;
  updatePassType(passTypeId: string, patch: Partial<Omit<SeasonPassType, 'id' | 'organizerId'>>): Promise<SeasonPassType | null>;
  getActivePassByUserAndType(
    userId: string,
    passTypeId: string
  ): Promise<SeasonPass | null>;
  insertPass(pass: Omit<SeasonPass, 'id' | 'createdAt' | 'updatedAt'>): Promise<SeasonPass>;
  updatePass(passId: string, patch: Partial<SeasonPass>): Promise<SeasonPass>;
  /**
   * Atomicky dekrementuje remaining_uses o 1 WHERE remaining_uses > 0.
   * Vrátí novou hodnotu remaining_uses, nebo null pokud již bylo 0 (race condition safe).
   * SQL: UPDATE ... SET remaining_uses = remaining_uses - 1 WHERE id = $1 AND remaining_uses > 0 RETURNING remaining_uses
   */
  atomicDecrementRemainingUses(passId: string): Promise<number | null>;
  getPass(passId: string): Promise<SeasonPass | null>;
  listPassesForUser(userId: string): Promise<SeasonPass[]>;
  insertPassUsage(usage: Omit<PassUsage, 'id' | 'createdAt'>): Promise<PassUsage>;
  /**
   * Aktualizuje ticketId na existujícím usage záznamu.
   * Voláno po insertPassTicket, kdy je znám ticketId.
   */
  updatePassUsage(usageId: string, patch: { ticketId: string }): Promise<void>;
  listPassUsages(passId: string): Promise<PassUsage[]>;
  insertPassTicket(ticket: Omit<PassTicket, 'ticketId' | 'issuedAt'>): Promise<PassTicket>;
  getExpiredPasses(beforeDate: Date): Promise<SeasonPass[]>;
  getEventByIdForOrganizer(
    eventId: string,
    organizerId: string
  ): Promise<EventRecord | null>;
}

export interface EventRecord {
  id: string;
  organizerId: string;
  dateStart: Date;
  dateEnd: Date | null;
  saleStartAt: Date | null;
  status: string;
  title: string;
  seatInfo?: string;
}

export interface GopayAdapter {
  /**
   * Creates a standard one-off payment.
   * Returns the GoPay payment object with id and gw_url.
   */
  createPayment(params: GopayPaymentParams): Promise<GopayPaymentResult>;

  /**
   * Creates a recurrent (ON_DEMAND) payment.
   * GoPay requires the first payment to also carry recurrence info so the
   * recurring token can be issued after successful authorisation.
   */
  createRecurrentPayment(params: GopayRecurrentParams): Promise<GopayPaymentResult>;

  /**
   * Charges an existing recurring token (ON_DEMAND).
   * Called during renewal — we initiate the charge, GoPay notifies via webhook.
   */
  chargeRecurrent(
    recurringToken: string,
    amount: number,
    currency: string
  ): Promise<GopayChargeResult>;

  /**
   * Cancels / voids a recurring token so no future charges can occur.
   */
  cancelRecurring(recurringToken: string): Promise<void>;

  /**
   * Issues a full or partial refund for a completed payment.
   */
  refundPayment(paymentId: string, amount: number): Promise<void>;
}

export interface GopayPaymentParams {
  amount: number;
  currency: string;
  orderId: string;
  description: string;
  returnUrl: string;
  notificationUrl: string;
  buyerEmail?: string;
}

export interface GopayRecurrentParams extends GopayPaymentParams {
  /**
   * ON_DEMAND means the platform decides when to charge.
   * valid_to is the latest date GoPay will accept a charge request.
   */
  recurrence: {
    cycle: 'ON_DEMAND';
    valid_to: string; // ISO date string e.g. "2027-04-03"
  };
}

export interface GopayPaymentResult {
  id: string;
  gwUrl: string;
  /** Present after payment is PAID — the token used for future ON_DEMAND charges. */
  recurringToken?: string;
}

export interface GopayChargeResult {
  paymentId: string;
  status: 'PAYMENT_METHOD_CHOSEN' | 'PAID' | 'CANCELED' | 'TIMEOUTED';
}

export interface EventBusAdapter {
  emit(topic: string, payload: Record<string, unknown>): Promise<void>;
}

export interface NotificationAdapter {
  sendPassSuspendedNotification(userId: string, passId: string): Promise<void>;
}

export interface Logger {
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

// =============================================================================
// SeasonPassService
// =============================================================================

export class SeasonPassService {
  constructor(
    private readonly db: DBAdapter,
    private readonly gopay: GopayAdapter,
    private readonly eventBus: EventBusAdapter,
    private readonly notifications: NotificationAdapter,
    private readonly logger: Logger,
    private readonly config: {
      gopayReturnBaseUrl: string;
      gopayNotificationUrl: string;
      enableProratedRefunds: boolean;
    }
  ) {}

  // ---------------------------------------------------------------------------
  // purchasePass
  // ---------------------------------------------------------------------------

  async purchasePass(
    userId: string,
    req: CreateSeasonPassRequest
  ): Promise<{ pass: SeasonPass; gopayRedirectUrl: string }> {
    const passType = await this.db.getPassType(req.passTypeId);
    if (!passType) {
      throw new Error(`PASS_TYPE_NOT_FOUND: ${req.passTypeId}`);
    }
    if (!passType.active) {
      throw new Error(`PASS_TYPE_INACTIVE: ${req.passTypeId}`);
    }
    if (passType.organizerId !== req.organizerId) {
      throw new Error(`PASS_TYPE_ORGANIZER_MISMATCH: ${req.passTypeId}`);
    }

    const existing = await this.db.getActivePassByUserAndType(userId, req.passTypeId);
    if (existing) {
      throw new Error(`DUPLICATE_PASS: user already has an active pass of type ${req.passTypeId}`);
    }

    const now = new Date();
    const endDate = this.computeEndDate(now, passType.validMonths);

    // Build pending pass record (no gopay ids yet)
    const pendingPass = await this.db.insertPass({
      userId,
      organizerId: req.organizerId,
      passTypeId: req.passTypeId,
      kind: passType.kind,
      name: passType.name,
      billingCycle: passType.billingCycle,
      price: passType.price,
      startDate: now,
      endDate,
      status: 'pending_payment',
      remainingUses: passType.totalUses,
      totalUses: passType.totalUses,
      benefits: passType.benefits,
      gopayPaymentId: undefined,
      gopayRecurringToken: undefined,
      nextBillingDate: req.billingCycle !== 'one_time' ? endDate : undefined,
      cancelledAt: undefined,
    });

    const returnUrl = `${this.config.gopayReturnBaseUrl}/passes/${pendingPass.id}/activate`;
    const commonParams: GopayPaymentParams = {
      amount: passType.price,
      currency: process.env.DEFAULT_CURRENCY ?? 'CZK',
      orderId: pendingPass.id,
      description: `Season pass: ${passType.name}`,
      returnUrl,
      notificationUrl: this.config.gopayNotificationUrl,
    };

    let gopayResult: GopayPaymentResult;

    if (req.billingCycle === 'one_time') {
      gopayResult = await this.gopay.createPayment(commonParams);
    } else {
      /**
       * Recurrent payment flow:
       * 1. The first payment carries recurrence.cycle = 'ON_DEMAND' and a
       *    valid_to date far enough in the future to cover all renewals.
       * 2. After the buyer authorises in GoPay gateway, GoPay issues a
       *    recurringToken in the webhook payload.
       * 3. For all subsequent billing cycles we call chargeRecurrent() with
       *    that token — we fully control when charges occur (ON_DEMAND vs
       *    EACH_PERIOD which GoPay would trigger automatically).
       */
      const validTo = this.computeRecurringValidTo(req.billingCycle);
      gopayResult = await this.gopay.createRecurrentPayment({
        ...commonParams,
        recurrence: {
          cycle: 'ON_DEMAND',
          valid_to: validTo,
        },
      });
    }

    // Persist the GoPay payment id so the webhook can match back to this pass
    await this.db.updatePass(pendingPass.id, {
      gopayPaymentId: gopayResult.id,
    });

    return {
      pass: { ...pendingPass, gopayPaymentId: gopayResult.id },
      gopayRedirectUrl: gopayResult.gwUrl,
    };
  }

  // ---------------------------------------------------------------------------
  // activatePass — called from GoPay webhook after successful payment
  // ---------------------------------------------------------------------------

  async activatePass(passId: string, gopayPaymentId: string, recurringToken?: string): Promise<SeasonPass> {
    const pass = await this.requirePass(passId);

    if (pass.status !== 'pending_payment') {
      throw new Error(`PASS_NOT_PENDING: ${passId} is ${pass.status}`);
    }

    const patch: Partial<SeasonPass> = {
      status: 'active',
      gopayPaymentId,
    };

    if (recurringToken) {
      patch.gopayRecurringToken = recurringToken;
    }

    const updated = await this.db.updatePass(passId, patch);

    await this.eventBus.emit('pass.activated', {
      passId,
      userId: pass.userId,
      organizerId: pass.organizerId,
      kind: pass.kind,
      billingCycle: pass.billingCycle,
    });

    return updated;
  }

  // ---------------------------------------------------------------------------
  // usePass — redeem a pass entry for a specific event
  // ---------------------------------------------------------------------------

  async usePass(
    passId: string,
    userId: string,
    eventId: string
  ): Promise<{ ticket: PassTicket; qrPayload: string }> {
    const pass = await this.requirePass(passId);

    if (pass.status !== 'active') {
      throw new Error(`PASS_NOT_ACTIVE: ${passId} is ${pass.status}`);
    }
    if (pass.userId !== userId) {
      throw new Error(`PASS_OWNERSHIP_DENIED: ${passId}`);
    }

    const event = await this.db.getEventByIdForOrganizer(eventId, pass.organizerId);
    if (!event) {
      throw new Error(`EVENT_NOT_FOUND_FOR_ORGANIZER: ${eventId}`);
    }
    if (event.status !== 'published') {
      throw new Error(`EVENT_NOT_PUBLISHED: ${eventId}`);
    }

    const now = new Date();

    if (pass.kind === 'season') {
      // Verify the event date falls within the pass validity window
      if (event.dateStart < pass.startDate || event.dateStart > pass.endDate) {
        throw new Error(`EVENT_OUT_OF_PASS_RANGE: event ${eventId} is outside pass validity`);
      }
    }

    if (pass.kind === 'flex') {
      // Optimistic fast-fail na základě načtené hodnoty (šetří DB round-trip).
      // Skutečná garance je atomický SQL dekrement níže — ten je race-condition safe.
      if ((pass.remainingUses ?? 0) <= 0) {
        throw new Error(`PASS_NO_REMAINING_USES: ${passId}`);
      }
    }

    // Early access check: if sale has not started publicly, verify earlyAccess window
    if (event.saleStartAt) {
      const earlyAccessCutoff = new Date(
        event.saleStartAt.getTime() - pass.benefits.earlyAccessHours * 60 * 60 * 1000
      );
      if (now < earlyAccessCutoff) {
        throw new Error(
          `EARLY_ACCESS_WINDOW_NOT_OPEN: sale starts at ${event.saleStartAt.toISOString()}, ` +
          `early access opens at ${earlyAccessCutoff.toISOString()}`
        );
      }
    }

    // Decrement uses atomically for flex passes before creating the ticket.
    // atomicDecrementRemainingUses uses SQL: SET remaining_uses = remaining_uses - 1
    // WHERE remaining_uses > 0 — prevents race condition with concurrent usePass calls.
    if (pass.kind === 'flex') {
      const newRemaining = await this.db.atomicDecrementRemainingUses(passId);
      if (newRemaining === null) {
        throw new Error(`PASS_NO_REMAINING_USES: ${passId}`);
      }
    }

    // Create the pass usage record
    const usage = await this.db.insertPassUsage({
      passId,
      eventId,
      ticketId: null,
      usedAt: now,
    });

    // Issue a ticket via the same flow as regular ticket issuance
    const ticket = await this.db.insertPassTicket({
      passId,
      eventId,
      userId,
      seatInfo: event.seatInfo ?? null,
    });

    // Back-fill ticketId on the usage record
    await this.db.updatePassUsage(usage.id, { ticketId: ticket.ticketId });

    // Generate TOTP QR payload using the same mechanism as regular tickets
    const qrPayload = this.generatePassQRPayload(ticket.ticketId, eventId);

    return { ticket, qrPayload };
  }

  // ---------------------------------------------------------------------------
  // renewPass — charge the stored recurring token for the next billing cycle
  // ---------------------------------------------------------------------------

  async renewPass(passId: string): Promise<SeasonPass> {
    const pass = await this.requirePass(passId);

    if (!pass.gopayRecurringToken) {
      throw new Error(`PASS_NO_RECURRING_TOKEN: ${passId}`);
    }
    if (pass.billingCycle === 'one_time') {
      throw new Error(`PASS_NOT_RENEWABLE: one_time pass ${passId}`);
    }

    let chargeResult: GopayChargeResult;
    try {
      /**
       * ON_DEMAND charge: we tell GoPay the amount and currency; GoPay debits
       * the saved payment method and returns a new payment ID asynchronously
       * via webhook. We record PAYMENT_METHOD_CHOSEN as an intermediate state.
       */
      chargeResult = await this.gopay.chargeRecurrent(
        pass.gopayRecurringToken,
        pass.price,
        process.env.DEFAULT_CURRENCY ?? 'CZK'
      );
    } catch (err) {
      this.logger.error('GoPay recurrent charge failed', { passId, err });
      await this.db.updatePass(passId, { status: 'suspended' });
      await this.notifications.sendPassSuspendedNotification(pass.userId, passId);
      throw err;
    }

    if (chargeResult.status === 'CANCELED' || chargeResult.status === 'TIMEOUTED') {
      await this.db.updatePass(passId, { status: 'suspended' });
      await this.notifications.sendPassSuspendedNotification(pass.userId, passId);
      throw new Error(`GOPAY_CHARGE_FAILED: ${chargeResult.status} for pass ${passId}`);
    }

    const newEndDate = this.addBillingCycle(pass.endDate, pass.billingCycle);
    const newNextBillingDate = this.addBillingCycle(newEndDate, pass.billingCycle);

    const updated = await this.db.updatePass(passId, {
      endDate: newEndDate,
      nextBillingDate: newNextBillingDate,
      gopayPaymentId: chargeResult.paymentId,
    });

    return updated;
  }

  // ---------------------------------------------------------------------------
  // cancelPass
  // ---------------------------------------------------------------------------

  async cancelPass(passId: string, userId: string): Promise<void> {
    const pass = await this.requirePass(passId);

    if (pass.userId !== userId) {
      throw new Error(`PASS_OWNERSHIP_DENIED: ${passId}`);
    }
    if (pass.status === 'cancelled') {
      throw new Error(`PASS_ALREADY_CANCELLED: ${passId}`);
    }

    const now = new Date();
    await this.db.updatePass(passId, {
      status: 'cancelled',
      cancelledAt: now,
    });

    // Cancel GoPay recurring token to prevent future charges
    if (pass.gopayRecurringToken) {
      try {
        await this.gopay.cancelRecurring(pass.gopayRecurringToken);
      } catch (err) {
        // Log but do not block the cancellation — token may already be expired
        this.logger.warn('Failed to cancel GoPay recurring token', { passId, err });
      }
    }

    // Prorated refund: only when feature flag is enabled and more than 7 days remain
    if (this.config.enableProratedRefunds && pass.gopayPaymentId) {
      const daysRemaining = (pass.endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
      if (daysRemaining > 7) {
        const totalDays = (pass.endDate.getTime() - pass.startDate.getTime()) / (1000 * 60 * 60 * 24);
        const refundRatio = daysRemaining / totalDays;
        const refundAmount = Math.floor(pass.price * refundRatio);
        if (refundAmount > 0) {
          try {
            await this.gopay.refundPayment(pass.gopayPaymentId, refundAmount);
          } catch (err) {
            this.logger.error('Prorated refund failed', { passId, refundAmount, err });
          }
        }
      }
    }

    await this.eventBus.emit('pass.cancelled', {
      passId,
      userId: pass.userId,
      organizerId: pass.organizerId,
    });
  }

  // ---------------------------------------------------------------------------
  // checkAndRenewExpiring — called by the daily cron job
  // ---------------------------------------------------------------------------

  async checkAndRenewExpiring(): Promise<{
    renewed: number;
    failed: number;
    totalRevenue: number;
  }> {
    const cutoff = new Date(Date.now() + 24 * 60 * 60 * 1000); // NOW + 24h
    const expiring = await this.db.getExpiredPasses(cutoff);

    let renewed = 0;
    let failed = 0;
    let totalRevenue = 0;

    for (const pass of expiring) {
      if (pass.billingCycle === 'one_time') continue;
      try {
        await this.renewPass(pass.id);
        renewed++;
        totalRevenue += pass.price;
        this.logger.info('Pass renewed', { passId: pass.id, userId: pass.userId });
      } catch (err) {
        failed++;
        this.logger.error('Pass renewal failed', { passId: pass.id, err });
      }
    }

    this.logger.info('checkAndRenewExpiring completed', { renewed, failed, totalRevenue });
    return { renewed, failed, totalRevenue };
  }

  // ---------------------------------------------------------------------------
  // Query methods (used by API routes and service registry)
  // ---------------------------------------------------------------------------

  async listPassesForUser(userId: string): Promise<SeasonPass[]> {
    return this.db.listPassesForUser(userId);
  }

  async getPassForUser(passId: string, userId: string): Promise<SeasonPass | null> {
    const pass = await this.db.getPass(passId);
    if (!pass) return null;
    if (pass.userId !== userId) return null;
    return pass;
  }

  async listPassUsages(passId: string): Promise<PassUsage[]> {
    return this.db.listPassUsages(passId);
  }

  async listPassTypes(organizerId: string): Promise<SeasonPassType[]> {
    return this.db.listPassTypes(organizerId);
  }

  /**
   * Called from the GoPay webhook for ON_DEMAND renewal charge confirmations.
   * Updates the payment ID after a successful recurring charge is confirmed.
   */
  async handleRenewalCallback(passId: string, gopayPaymentId: string): Promise<void> {
    const pass = await this.db.getPass(passId);
    if (!pass) {
      throw new Error(`PASS_NOT_FOUND: ${passId}`);
    }
    await this.db.updatePass(passId, { gopayPaymentId });
  }

  // ---------------------------------------------------------------------------
  // Admin: Pass Type management (organizer CRUD)
  // ---------------------------------------------------------------------------

  async createPassType(
    organizerId: string,
    data: {
      name: string;
      kind: SeasonPassKind;
      billingCycle: BillingCycle;
      price: number;
      totalUses?: number;
      validMonths: number;
      benefits: PassBenefits;
    }
  ): Promise<SeasonPassType> {
    if (data.kind === 'flex' && !data.totalUses) {
      throw new Error('PASS_TYPE_FLEX_REQUIRES_TOTAL_USES');
    }
    if (data.price < 0) {
      throw new Error('PASS_TYPE_INVALID_PRICE');
    }
    if (data.validMonths < 1) {
      throw new Error('PASS_TYPE_INVALID_VALID_MONTHS');
    }

    return this.db.insertPassType({
      organizerId,
      name: data.name,
      kind: data.kind,
      billingCycle: data.billingCycle,
      price: data.price,
      totalUses: data.totalUses,
      validMonths: data.validMonths,
      benefits: data.benefits,
      active: true,
    });
  }

  async updatePassType(
    passTypeId: string,
    organizerId: string,
    patch: Partial<Omit<SeasonPassType, 'id' | 'organizerId'>>
  ): Promise<SeasonPassType> {
    const existing = await this.db.getPassType(passTypeId);
    if (!existing) {
      throw new Error(`PASS_TYPE_NOT_FOUND: ${passTypeId}`);
    }
    if (existing.organizerId !== organizerId) {
      throw new Error(`PASS_TYPE_ORGANIZER_MISMATCH: ${passTypeId}`);
    }

    const updated = await this.db.updatePassType(passTypeId, patch);
    if (!updated) {
      throw new Error(`PASS_TYPE_NOT_FOUND: ${passTypeId}`);
    }
    return updated;
  }

  async deactivatePassType(passTypeId: string, organizerId: string): Promise<void> {
    const existing = await this.db.getPassType(passTypeId);
    if (!existing) {
      throw new Error(`PASS_TYPE_NOT_FOUND: ${passTypeId}`);
    }
    if (existing.organizerId !== organizerId) {
      throw new Error(`PASS_TYPE_ORGANIZER_MISMATCH: ${passTypeId}`);
    }

    await this.db.updatePassType(passTypeId, { active: false });
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async requirePass(passId: string): Promise<SeasonPass> {
    const pass = await this.db.getPass(passId);
    if (!pass) {
      throw new Error(`PASS_NOT_FOUND: ${passId}`);
    }
    return pass;
  }

  private computeEndDate(from: Date, validMonths: number): Date {
    const end = new Date(from);
    end.setMonth(end.getMonth() + validMonths);
    return end;
  }

  private addBillingCycle(from: Date, cycle: 'monthly' | 'annual' | 'one_time'): Date {
    const next = new Date(from);
    if (cycle === 'monthly') {
      next.setMonth(next.getMonth() + 1);
    } else if (cycle === 'annual') {
      next.setFullYear(next.getFullYear() + 1);
    }
    return next;
  }

  /**
   * Computes the GoPay valid_to date for a recurring token.
   * We set it generously (10 years) so the token remains valid across
   * multiple renewals; GoPay will still let us cancel it at any time.
   */
  private computeRecurringValidTo(cycle: 'monthly' | 'annual' | 'one_time'): string {
    const d = new Date();
    d.setFullYear(d.getFullYear() + (cycle === 'annual' ? 20 : 10));
    return d.toISOString().slice(0, 10); // "YYYY-MM-DD"
  }

  /**
   * Generates a TOTP QR payload for a pass-issued ticket.
   * Mirrors the logic in TicketQRService.generateQR but uses the pass ticket id
   * as the identifier so the gate scanner can validate it.
   *
   * The actual TOTP secret generation and encryption is delegated to the DB
   * adapter's insertPassTicket — the secret is stored there in the same
   * totp_secret_encrypted column as regular tickets.
   */
  private generatePassQRPayload(ticketId: string, eventId: string): string {
    // The QR payload format: BASE64( ticketId|totp|timestamp|eventId|hmac )
    // Actual TOTP computation happens in the ticket-qr service at display time.
    // Here we return a stable reference that the frontend uses to call /qr.
    return `pass-ticket:${ticketId}:${eventId}`;
  }
}
