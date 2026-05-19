import { randomUUID } from 'crypto';

export type GopayPaymentStatus =
  | 'CREATED'
  | 'PAYMENT_METHOD_CHOSEN'
  | 'PAID'
  | 'AUTHORIZED'
  | 'CANCELED'
  | 'TIMEOUTED'
  | 'REFUNDED';

export interface GopayPayment {
  id: string;
  orderId: string;
  gatewayUrl: string;
  status: GopayPaymentStatus;
  amountHalire: number;
  currency: string;
  createdAt: string;
  updatedAt: string;
  paymentInstrument: string | null;
}

export interface CreatePaymentInput {
  orderId: string;
  amountHalire: number;
  currency?: string;
  buyerEmail: string;
  buyerName?: string;
  description?: string;
  returnUrl?: string;
}

export interface GopayPaymentService {
  createPayment(input: CreatePaymentInput): Promise<GopayPayment>;
  getPayment(paymentId: string): Promise<GopayPayment>;
  refundPayment(paymentId: string, amountHalire: number): Promise<GopayPayment>;
}

export function createGopayPayment(): GopayPaymentService {
  const store = new Map<string, GopayPayment>();
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

  return {
    createPayment(input: CreatePaymentInput): Promise<GopayPayment> {
      const id = `mock-pay-${randomUUID().slice(0, 8)}`;
      const now = new Date().toISOString();
      const payment: GopayPayment = {
        id,
        orderId: input.orderId,
        gatewayUrl: `${baseUrl}/mock-gopay/${id}`,
        status: 'CREATED',
        amountHalire: input.amountHalire,
        currency: input.currency ?? 'CZK',
        createdAt: now,
        updatedAt: now,
        paymentInstrument: null,
      };
      store.set(id, payment);
      return Promise.resolve(payment);
    },
    getPayment(paymentId: string): Promise<GopayPayment> {
      const p = store.get(paymentId);
      if (!p) return Promise.reject(new Error(`Mock payment not found: ${paymentId}`));
      return Promise.resolve(p);
    },
    refundPayment(paymentId: string): Promise<GopayPayment> {
      const p = store.get(paymentId);
      if (!p) return Promise.reject(new Error(`Mock payment not found: ${paymentId}`));
      const refunded: GopayPayment = {
        ...p,
        status: 'REFUNDED',
        updatedAt: new Date().toISOString(),
      };
      store.set(paymentId, refunded);
      return Promise.resolve(refunded);
    },
  };
}
