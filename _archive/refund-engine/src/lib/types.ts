export interface DbAdapter {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<void>;
  transaction<T>(fn: (tx: DbAdapter) => Promise<T>): Promise<T>;
}

export type RefundReason = 'event_cancelled' | 'customer_request' | 'duplicate_order' | 'fraud' | 'chargeback';
export type RefundRequestedBy = 'customer' | 'promoter' | 'platform_admin' | 'system';
export type RefundStatus = 'pending' | 'completed' | 'failed';
export type PaymentGateway = 'gopay' | 'stripe' | 'free';

export interface RefundRequest {
  orderId: string;
  promoterId: string;
  reason: RefundReason;
  requestedBy: RefundRequestedBy;
  amountHalire?: number;  // null = plný refund
}

export interface RefundResult {
  refundId: string;
  orderId: string;
  amountHalire: number;
  status: RefundStatus;
  paymentGateway: PaymentGateway;
  gatewayRefundId?: string;
  processedAt: string;
}

export interface Order {
  id: string;
  promoterId: string;
  eventId: string;
  status: string;
  totalAmountHalire: number;
  paymentGateway: string;
  externalPaymentId?: string;
  createdAt: string;
}

export interface RefundPolicy {
  promoterId: string;
  eventId?: string;
  refundWindowDays: number;
  allowCustomerRefunds: boolean;
  maxRefundPercentage: number;  // 0-100
}

export interface RefundEligibility {
  eligible: boolean;
  reason?: string;
  maxRefundableHalire?: number;
}

export interface PaymentReversalAdapter {
  reversePayment(externalPaymentId: string, amountHalire: number): Promise<{ gatewayRefundId: string }>;
}

export type CallGopayApiFn = (path: string, method: string, body?: unknown) => Promise<unknown>;
export type CallStripeApiFn = (path: string, body?: unknown) => Promise<unknown>;
export type SendEmailFn = (to: string, subject: string, body: string) => Promise<void>;
