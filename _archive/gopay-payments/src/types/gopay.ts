// =============================================================================
// GoPay — typové definice
// =============================================================================

export type GopayPaymentStatus =
  | 'CREATED'
  | 'PAYMENT_METHOD_CHOSEN'
  | 'PAID'
  | 'AUTHORIZED'
  | 'CANCELED'
  | 'TIMEOUTED'
  | 'REFUNDED'
  | 'PARTIALLY_REFUNDED';

export type GopayPaymentInstrument =
  | 'PAYMENT_CARD'
  | 'BANK_ACCOUNT'
  | 'GPAY'
  | 'APPLE_PAY'
  | 'GOOGLE_PAY'
  | 'PAYPAL'
  | 'MPAYMENT'
  | 'PRSMS'
  | 'PAYSAFECARD'
  | 'BITCOIN';

export type GopayCurrency = 'CZK' | 'EUR';

export interface GopayLineItem {
  name: string;
  amountHalire: number;   // INTEGER haléře
  count: number;
}

export interface GopayCreatePaymentInput {
  orderId: string;
  amountHalire: number;           // INTEGER haléře (1 Kč = 100 haléřů)
  currency: GopayCurrency;
  description: string;
  buyerEmail: string;
  buyerFirstName?: string;
  buyerLastName?: string;
  buyerPhone?: string;
  items: GopayLineItem[];
  returnUrl?: string;
  allowedPaymentInstruments?: GopayPaymentInstrument[];
}

export interface GopayPayment {
  id: string;                     // interní UUID (payments.gopay_payments.id)
  orderId: string;
  status: GopayPaymentStatus;
  amountHalire: number;
  currency: GopayCurrency;
  gatewayUrl: string;
  paymentInstrument: GopayPaymentInstrument | null;
  createdAt: string;
  updatedAt: string;
}

export interface GopayWebhookPayload {
  id: string;                     // GoPay payment id (external)
  orderNumber: string;
  status: GopayPaymentStatus;
}
