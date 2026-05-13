import type { PaymentReversalAdapter, CallGopayApiFn, CallStripeApiFn } from './types.js';

export function createGopayReversalAdapter(callGopayApi: CallGopayApiFn): PaymentReversalAdapter {
  return {
    async reversePayment(externalPaymentId: string, amountHalire: number) {
      const response = await callGopayApi(
        `/api/payments/${externalPaymentId}/refund`,
        'POST',
        { amount: amountHalire }
      ) as { id: string };
      return { gatewayRefundId: String(response.id) };
    }
  };
}

export function createStripeReversalAdapter(callStripeApi: CallStripeApiFn): PaymentReversalAdapter {
  return {
    async reversePayment(externalPaymentId: string, amountHalire: number) {
      const response = await callStripeApi('/v1/refunds', {
        payment_intent: externalPaymentId,
        amount: amountHalire,
      }) as { id: string };
      return { gatewayRefundId: String(response.id) };
    }
  };
}

export function createFreeOrderAdapter(): PaymentReversalAdapter {
  return {
    async reversePayment(_id: string, _amount: number) {
      return { gatewayRefundId: 'free-order-no-reversal' };
    }
  };
}

export function getReversalAdapter(
  gateway: string,
  config: {
    gopayCallFn?: CallGopayApiFn;
    stripeCallFn?: CallStripeApiFn;
  }
): PaymentReversalAdapter {
  switch (gateway) {
    case 'gopay':
      if (!config.gopayCallFn) throw new Error('GoPay call function not configured');
      return createGopayReversalAdapter(config.gopayCallFn);
    case 'stripe':
      if (!config.stripeCallFn) throw new Error('Stripe call function not configured');
      return createStripeReversalAdapter(config.stripeCallFn);
    case 'free':
      return createFreeOrderAdapter();
    default:
      throw new Error(`Unknown payment gateway: ${gateway}`);
  }
}
