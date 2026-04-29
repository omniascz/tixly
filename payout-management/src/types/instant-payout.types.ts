export type InstantPayoutStatus = 'pending' | 'processing' | 'paid' | 'failed' | 'cancelled';
export type InstantPayoutMethod = 'card' | 'bank_account';

export interface InstantPayout {
  id: string;
  promoterId: string;
  amountCzk: number;        // gross amount requested
  feeCzk: number;           // 1% of amount, min 10, max 200
  netAmountCzk: number;     // amountCzk - feeCzk
  method: InstantPayoutMethod;
  destinationId: string;    // Stripe card/bank account ID
  status: InstantPayoutStatus;
  stripePayoutId: string | null;
  failureReason: string | null;
  requestedAt: Date;
  processedAt: Date | null;
}

export interface InstantPayoutInput {
  promoterId: string;
  amountCzk: number;
  method: InstantPayoutMethod;
  destinationId: string;
}

export interface StripeAdapter {
  createInstantPayout(params: {
    amount: number;        // in CZK cents (halire)
    currency: string;
    method: InstantPayoutMethod;
    destination: string;
  }): Promise<{ id: string }>;
  cancelPayout(stripePayoutId: string): Promise<void>;
  getPayoutStatus(stripePayoutId: string): Promise<{ status: string; failureMessage?: string }>;
}

export class InstantPayoutError extends Error {
  constructor(
    public readonly code:
      | 'AMOUNT_TOO_LOW'
      | 'AMOUNT_TOO_HIGH'
      | 'PENDING_PAYOUT_EXISTS'
      | 'PAYOUT_NOT_FOUND'
      | 'PAYOUT_NOT_CANCELLABLE'
      | 'STRIPE_ERROR',
    message: string,
  ) {
    super(message);
    this.name = 'InstantPayoutError';
  }
}
