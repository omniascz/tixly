// =============================================================================
// BNPL (Buy Now Pay Later) — domain types
//
// BNPL = zákazník zaplatí celou částku za 14–30 dní bez úroku.
// Liší se od `installments/` modulu, který řeší splátky (více plateb v čase).
//
// Všechny peněžní částky jsou v haléřích (1 CZK = 100 haléřů).
// =============================================================================

export type BnplProvider = 'twisto' | 'klarna';

export type BnplPaymentStatus =
  | 'pending'      // waiting for provider approval
  | 'approved'     // provider approved, goods can ship
  | 'active'       // goods delivered, due date in future
  | 'paid'         // customer paid in full
  | 'overdue'      // past due date, not paid
  | 'defaulted'    // written off
  | 'cancelled'    // cancelled before delivery
  | 'rejected';    // provider rejected

export interface BnplPayment {
  id: string;
  orderId: string;
  userId: string;
  provider: BnplProvider;
  providerPaymentId: string | null;   // ID in provider's system
  amountCzk: number;                   // integer halíře
  dueDate: Date;                       // deadline to pay
  deferralDays: number;                // 14 or 30
  status: BnplPaymentStatus;
  approvedAt: Date | null;
  paidAt: Date | null;
  failureReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface InitiateBnplInput {
  orderId: string;
  userId: string;
  provider: BnplProvider;
  amountCzk: number;
  deferralDays: 14 | 30;
  customerEmail: string;
  customerName: string;
  customerPhone?: string;
  customerBirthDate?: string;  // ISO date, Twisto requires for risk assessment
}

export interface BnplEligibilityResult {
  eligible: boolean;
  reason: string | null;
  maxAmountCzk: number | null;
}

// ---------------------------------------------------------------------------
// Provider adapters — injected by the caller, no real HTTP here
// ---------------------------------------------------------------------------

export interface TwistoAdapter {
  createPayment(params: {
    amount: number;
    currency: string;
    orderId: string;
    customer: { email: string; name: string; phone?: string; birthDate?: string };
    deferralDays: number;
  }): Promise<{ paymentId: string; approved: boolean; rejectReason?: string }>;
  cancelPayment(paymentId: string): Promise<void>;
  getPaymentStatus(paymentId: string): Promise<{ status: string; paidAt?: string }>;
}

export interface KlarnaAdapter {
  createSession(params: {
    amount: number;
    currency: string;
    orderId: string;
    customer: { email: string; name: string };
  }): Promise<{ sessionId: string; approved: boolean }>;
  authorizePayment(sessionId: string): Promise<{ paymentId: string; status: string }>;
  cancelOrder(paymentId: string): Promise<void>;
  getOrderStatus(paymentId: string): Promise<{ status: string; capturedAt?: string }>;
}

// ---------------------------------------------------------------------------
// Error class
// ---------------------------------------------------------------------------

export class BnplError extends Error {
  constructor(
    public readonly code:
      | 'PAYMENT_NOT_FOUND'
      | 'PROVIDER_REJECTED'
      | 'AMOUNT_TOO_LOW'
      | 'AMOUNT_TOO_HIGH'
      | 'INVALID_DEFERRAL_DAYS'
      | 'PAYMENT_NOT_CANCELLABLE'
      | 'USER_NOT_ELIGIBLE'
      | 'PROVIDER_ERROR',
    message: string,
  ) {
    super(message);
    this.name = 'BnplError';
    Object.setPrototypeOf(this, BnplError.prototype);
  }
}

// ---------------------------------------------------------------------------
// DB + service deps (dependency injection pattern)
// ---------------------------------------------------------------------------

export interface DbAdapter {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<void>;
  transaction<T>(fn: (db: DbAdapter) => Promise<T>): Promise<T>;
}

export interface ServiceDeps {
  db: DbAdapter;
  twisto: TwistoAdapter;
  klarna: KlarnaAdapter;
}
