// customer-view.ts — typy pro modul Single Customer View (360° profil).

export interface CustomerProfile {
  userId: string;
  email: string;
  name: string;
  phone: string | null;
  registeredAt: Date;
  // LTV
  lifetimeValueHalire: number;
  lifetimeOrderCount: number;
  avgOrderValueHalire: number;
  // RFM
  rfm: {
    recency: 1 | 2 | 3 | 4 | 5;
    frequency: 1 | 2 | 3 | 4 | 5;
    monetary: 1 | 2 | 3 | 4 | 5;
    cohort: string;
  };
  // Loyalty
  loyaltyTier: string;
  loyaltyPointsBalance: number;
  // Activity
  lastPurchaseAt: Date | null;
  lastEventAttendedAt: Date | null;
  daysSinceLastPurchase: number | null;
  // Segments
  segmentIds: string[];
  // Counts
  totalTicketsBought: number;
  totalEventsAttended: number;
  totalRefunds: number;
  totalRefundedHalire: number;
  // Referral
  referralCode: string | null;
  referralConversions: number;
  // Risk
  fraudRiskScore: number | null;
  isBlacklisted: boolean;
}

export interface CustomerOrderHistory {
  orderId: string;
  orderNumber: string;
  eventName: string;
  eventDate: Date;
  totalHalire: number;
  ticketCount: number;
  status: string;
  createdAt: Date;
}

export interface CustomerTimeline {
  type:
    | 'purchase'
    | 'refund'
    | 'ticket_scan'
    | 'resale'
    | 'gift'
    | 'loyalty_redemption'
    | 'support_ticket';
  description: string;
  amountHalire: number | null;
  occurredAt: Date;
  metadata: Record<string, unknown>;
}

// ─── Errors ──────────────────────────────────────────────────────────────────

export class CustomerNotFoundError extends Error {
  constructor(public readonly userId: string) {
    super(`Zákazník nenalezen: userId=${userId}`);
    this.name = 'CustomerNotFoundError';
  }
}

// ─── Pagination ──────────────────────────────────────────────────────────────

export interface Pagination {
  limit: number;
  offset: number;
}
