// Stub for stripe-payments/src/services/stripe-payment.service.js
// Used by Vitest alias so order-service.ts can be transformed.
// Tests override this via vi.mock() if needed.

export async function createStripePaymentIntent(..._args: unknown[]): Promise<never> {
  throw new Error('stripe-payment-service stub: replace with vi.mock in tests');
}
