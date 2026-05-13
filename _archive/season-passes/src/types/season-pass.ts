// =============================================================================
// Season Passes — Domain Types
// =============================================================================

export type SeasonPassKind = 'season' | 'flex';

export type BillingCycle = 'monthly' | 'annual' | 'one_time';

export type SeasonPassStatus =
  | 'active'
  | 'expired'
  | 'cancelled'
  | 'suspended'
  | 'pending_payment';

// ---------------------------------------------------------------------------
// Benefits attached to a pass type
// ---------------------------------------------------------------------------

export interface PassBenefits {
  /** Percentage discount on addon ticket purchases (0–100). */
  addonDiscountPercent: number;
  /** How many hours before public sale_start the pass holder gets access. */
  earlyAccessHours: number;
  /** Number of complimentary guest passes included. */
  guestPasses: number;
}

// ---------------------------------------------------------------------------
// Pass type — configuration set by the organizer
// ---------------------------------------------------------------------------

export interface SeasonPassType {
  id: string;
  organizerId: string;
  name: string;
  kind: SeasonPassKind;
  billingCycle: BillingCycle;
  /** Price in INTEGER halíře (1 Kč = 100 halířů). Never use FLOAT or NUMERIC. */
  price: number;
  /** For flex passes: total number of entries included. */
  totalUses?: number;
  /** Duration of the pass in full calendar months from purchase date. */
  validMonths: number;
  benefits: PassBenefits;
  active: boolean;
}

// ---------------------------------------------------------------------------
// Issued pass — one per user purchase
// ---------------------------------------------------------------------------

export interface SeasonPass {
  id: string;
  userId: string;
  organizerId: string;
  passTypeId: string;
  kind: SeasonPassKind;
  name: string;
  billingCycle: BillingCycle;
  /** Amount actually paid at purchase / last renewal in CZK. */
  price: number;
  startDate: Date;
  endDate: Date;
  status: SeasonPassStatus;
  /** Remaining entries for flex passes; undefined for season passes. */
  remainingUses?: number;
  /** Total entry budget for flex passes; undefined for season passes. */
  totalUses?: number;
  benefits: PassBenefits;
  /** GoPay recurring token for ON_DEMAND charges; present after first payment. */
  gopayRecurringToken?: string;
  /** GoPay payment ID of the most recent payment. */
  gopayPaymentId?: string;
  /** When the next automatic renewal charge will be attempted. */
  nextBillingDate?: Date;
  cancelledAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

// ---------------------------------------------------------------------------
// Usage record — one row per entry/redemption
// ---------------------------------------------------------------------------

export interface PassUsage {
  id: string;
  passId: string;
  eventId: string;
  /** Linked ticket id; may be null if ticket creation is deferred. */
  ticketId: string | null;
  usedAt: Date;
  createdAt: Date;
}

// ---------------------------------------------------------------------------
// Ticket produced when a pass is redeemed
// ---------------------------------------------------------------------------

export interface PassTicket {
  ticketId: string;
  passId: string;
  eventId: string;
  userId: string;
  seatInfo: string | null;
  issuedAt: Date;
}

// ---------------------------------------------------------------------------
// API request / response shapes
// ---------------------------------------------------------------------------

export interface CreateSeasonPassRequest {
  kind: SeasonPassKind;
  organizerId: string;
  billingCycle: BillingCycle;
  /** References passes.season_pass_types.id — the product the organizer offers. */
  passTypeId: string;
}

export interface UsePassRequest {
  eventId: string;
}

export interface UsePassResponse {
  ticketId: string;
  qrPayload: string;
  expiresAt: Date;
  seatInfo?: string;
}
