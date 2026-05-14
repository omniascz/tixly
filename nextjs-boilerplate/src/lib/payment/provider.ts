/**
 * Payment provider switcher.
 *
 * Pokud `STRIPE_SECRET_KEY` env je nastaven a kupec si zvolil `gopay` (= karta),
 * checkout vytvoří Stripe Checkout Session. Jinak fallback na mock GoPay (dev).
 *
 * Wero / Przelewy24 zůstávají jako mock dokud nedostanou vlastní integraci.
 */

import { randomUUID } from 'crypto';
import { createStripeCheckoutSession } from './stripe';

export interface CreatePaymentInput {
  orderId: string;
  amountHalire: number;
  currency: string;
  buyerEmail: string;
  description: string;
  paymentMethod: 'gopay' | 'wero' | 'przelewy24';
  appUrl: string;
}

export interface CreatePaymentResult {
  paymentId: string;
  gatewayUrl: string;
  provider: 'stripe' | 'mock-gopay' | 'mock-wero' | 'mock-przelewy24';
  paymentIntentId?: string | null;
}

/**
 * Vytvoří payment session pro daný order. Volá se z checkout endpointu po commit
 * základní objednávky (status='pending'). Vrácený gatewayUrl je redirect target.
 */
export async function createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
  const useStripe =
    input.paymentMethod === 'gopay' && Boolean(process.env.STRIPE_SECRET_KEY);

  if (useStripe) {
    const session = await createStripeCheckoutSession({
      orderId: input.orderId,
      amountHalire: input.amountHalire,
      currency: input.currency,
      buyerEmail: input.buyerEmail,
      description: input.description,
      successUrl: `${input.appUrl}/cs/order-confirmation/${input.orderId}`,
      cancelUrl: `${input.appUrl}/cs/checkout?orderId=${input.orderId}&canceled=1`,
      idempotencyKey: input.orderId,
    });
    return {
      paymentId: session.paymentId,
      gatewayUrl: session.gatewayUrl,
      provider: 'stripe',
      paymentIntentId: session.paymentIntentId,
    };
  }

  // Mock fallback — současné chování pro dev / wero / przelewy24
  const paymentId = `mock-pay-${randomUUID().slice(0, 8)}`;
  const gatewayUrl =
    input.paymentMethod === 'wero'
      ? `/mock-wero/${paymentId}`
      : input.paymentMethod === 'przelewy24'
        ? `/mock-przelewy24/${paymentId}`
        : `/mock-gopay/${paymentId}`;
  return {
    paymentId,
    gatewayUrl,
    provider: input.paymentMethod === 'wero'
      ? 'mock-wero'
      : input.paymentMethod === 'przelewy24'
        ? 'mock-przelewy24'
        : 'mock-gopay',
  };
}
