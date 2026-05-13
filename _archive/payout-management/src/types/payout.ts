export type PayoutStatus = 'pending' | 'approved' | 'processing' | 'paid' | 'failed';
export type PayoutCycle = 'daily' | 'weekly' | 'monthly' | 'post_event' | 'manual';

export interface PayoutSettings {
  promoterId: string;
  payoutCycle: PayoutCycle;
  rollingReservePct: number;    // 500 = 5.00 %
  reserveReleaseDays: number;
  minPayoutAmount: number;      // haléře
}

export interface Payout {
  id: string;
  promoterId: string;
  periodFrom: string;
  periodTo: string;
  grossRevenue: number;
  platformFees: number;
  refunds: number;
  chargebacks: number;
  rollingReserve: number;
  netPayout: number;
  status: PayoutStatus;
  payoutCycle: string | null;
  bankReference: string | null;
  paidAt: string | null;
  failureReason: string | null;
  retryCount: number;
  approvedBy: string | null;
  approvedAt: string | null;
  createdAt: string;
}

export interface EventSettlement {
  id: string;
  eventId: string;
  promoterId: string;
  payoutId: string | null;
  ticketsSold: number;
  grossRevenue: number;
  platformFees: number;
  refundsCount: number;
  refundsAmount: number;
  chargebacksCount: number;
  chargebacksAmount: number;
  netRevenue: number;
  settled: boolean;
  settledAt: string | null;
}

export interface RollingReserveEntry {
  id: string;
  promoterId: string;
  payoutId: string | null;
  amount: number;
  releaseDate: string;
  released: boolean;
  releasedAt: string | null;
  createdAt: string;
}

export interface PayoutSummary {
  promoterId: string;
  pendingAmount: number;       // součet net_payout z pending payoutů
  availableReserve: number;    // reserve k uvolnění (release_date <= dnes)
  totalReserveHeld: number;    // celková zadržená reserve
  lastPaidAt: string | null;
  nextPayoutDate: string | null;
}

export interface SettlementReport {
  payout: Payout;
  settlements: EventSettlement[];
  reserveEntries: RollingReserveEntry[];
  summary: {
    totalGross: number;
    totalFees: number;
    totalRefunds: number;
    totalChargebacks: number;
    totalReserve: number;
    totalNet: number;
  };
}
