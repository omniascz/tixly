/**
 * Payment provider switcher.
 *
 * CZ/SK: GoPay nebo ComGate (via PAYMENT_PROVIDER + PAYMENT_PROVIDER_EUR)
 * EU/UK/Global: Stripe (automatic_payment_methods → iDEAL, Klarna, Apple Pay, BLIK etc.)
 * PL: Przelewy24 real (when P24_MERCHANT_ID + P24_CRC_KEY + P24_API_KEY set)
 * NL/BE/FR/EU: Mollie (when MOLLIE_API_KEY set)
 * Global: PayPal standalone (when PAYPAL_CLIENT_ID + PAYPAL_CLIENT_SECRET set)
 * A2A: Wero mock (real API vyžaduje EPI banking partnership)
 *
 * ENV switching:
 *   PAYMENT_PROVIDER=gopay|comgate|stripe|mock   — globální default
 *   PAYMENT_PROVIDER_EUR=gopay|comgate|stripe     — explicit override pro EUR
 *
 * Pokud STRIPE_SECRET_KEY set a PAYMENT_PROVIDER_EUR není nastaveno, EUR platby
 * jdou automaticky přes Stripe (iDEAL, Bancontact, Klarna, Apple Pay atd.).
 */

import { randomUUID } from 'crypto';
import { createComGateSession, getComGateConfig } from './comgate';
import { createGopaySession, getGopayConfig } from './gopay-real';
import { createStripeCheckoutSession } from './stripe';
import { createP24Transaction, getP24Config } from './przelewy24';
import { createMolliePayment, getMollieConfig } from './mollie';
import { createPayPalOrder, getPayPalConfig } from './paypal';
import { assertMockPaymentsAllowed } from './mock-guard';

export interface CreatePaymentInput {
  orderId: string;
  amountHalire: number;
  currency: string;
  buyerEmail: string;
  buyerName?: string;
  description: string;
  paymentMethod: 'gopay' | 'wero' | 'przelewy24' | 'bank_transfer' | 'mollie' | 'paypal';
  appUrl: string;
}

export interface CreatePaymentResult {
  paymentId: string;
  gatewayUrl: string;
  provider:
    | 'gopay'
    | 'comgate'
    | 'stripe'
    | 'mock-gopay'
    | 'mock-wero'
    | 'mock-przelewy24'
    | 'bank_transfer'
    | 'przelewy24'
    | 'mollie'
    | 'paypal';
  paymentIntentId?: string | null;
}

type ProviderName = 'gopay' | 'comgate' | 'stripe' | 'mock';

function selectProviderName(currency: string): ProviderName {
  // Explicit EUR override wins
  if (currency === 'EUR' && process.env.PAYMENT_PROVIDER_EUR) {
    return process.env.PAYMENT_PROVIDER_EUR as ProviderName;
  }
  // Auto-route EUR to Stripe when key is present (covers DE/AT/NL/BE/FR/UK/Global)
  if (currency === 'EUR' && process.env.STRIPE_SECRET_KEY) {
    return 'stripe';
  }
  return (process.env.PAYMENT_PROVIDER ?? 'mock') as ProviderName;
}

/**
 * Vytvoří payment session. Vrácený gatewayUrl je redirect target.
 */
export async function createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
  // Bank transfer — žádný redirect, kupec dostane VS a bankovní účet
  if (input.paymentMethod === 'bank_transfer') {
    const paymentId = `bank-${randomUUID().slice(0, 8)}`;
    return {
      paymentId,
      gatewayUrl: `${input.appUrl}/cs/order-confirmation/${input.orderId}?awaiting=bank_transfer`,
      provider: 'bank_transfer',
    };
  }

  // Wero (European A2A) — real API vyžaduje EPI banking partnership, zůstává mock
  if (input.paymentMethod === 'wero') {
    assertMockPaymentsAllowed();
    const paymentId = `mock-pay-${randomUUID().slice(0, 8)}`;
    return {
      paymentId,
      gatewayUrl: `/mock-wero/${paymentId}`,
      provider: 'mock-wero',
    };
  }

  // Przelewy24 (PL) — real implementation when configured, mock fallback
  if (input.paymentMethod === 'przelewy24') {
    const cfg = getP24Config();
    if (cfg.isConfigured) {
      const notificationUrl = `${input.appUrl}/api/payments/przelewy24/webhook`;
      const returnUrl = `${input.appUrl}/cs/order-confirmation/${input.orderId}`;
      const session = await createP24Transaction({
        orderId: input.orderId,
        amountGrosze: input.amountHalire,
        currency: input.currency,
        buyerEmail: input.buyerEmail,
        buyerName: input.buyerName,
        description: input.description,
        notificationUrl,
        returnUrl,
      });
      return {
        paymentId: session.paymentId,
        gatewayUrl: session.gatewayUrl,
        provider: 'przelewy24',
      };
    }
    assertMockPaymentsAllowed();
    const paymentId = `mock-pay-${randomUUID().slice(0, 8)}`;
    return {
      paymentId,
      gatewayUrl: `/mock-przelewy24/${paymentId}`,
      provider: 'mock-przelewy24',
    };
  }

  // Mollie (NL/BE/FR/EU — iDEAL, Bancontact, SEPA, Klarna, PayPal)
  if (input.paymentMethod === 'mollie') {
    const cfg = getMollieConfig();
    if (cfg.isConfigured) {
      const amountValue = (input.amountHalire / 100).toFixed(2);
      const session = await createMolliePayment({
        orderId: input.orderId,
        amountValue,
        currency: input.currency,
        buyerEmail: input.buyerEmail,
        description: input.description,
        redirectUrl: `${input.appUrl}/cs/order-confirmation/${input.orderId}`,
        webhookUrl: `${input.appUrl}/api/payments/mollie/webhook`,
      });
      return {
        paymentId: session.id,
        gatewayUrl: session.checkoutUrl,
        provider: 'mollie',
      };
    }
    assertMockPaymentsAllowed();
    const paymentId = `mock-pay-${randomUUID().slice(0, 8)}`;
    return {
      paymentId,
      gatewayUrl: `/mock-gopay/${paymentId}`,
      provider: 'mock-gopay',
    };
  }

  // PayPal standalone (DE/AT/FR/Global)
  if (input.paymentMethod === 'paypal') {
    const cfg = getPayPalConfig();
    if (cfg.isConfigured) {
      const amountValue = (input.amountHalire / 100).toFixed(2);
      const session = await createPayPalOrder({
        orderId: input.orderId,
        amountValue,
        currency: input.currency,
        description: input.description,
        returnUrl: `${input.appUrl}/api/payments/paypal/capture?orderId=${input.orderId}`,
        cancelUrl: `${input.appUrl}/cs/checkout?canceled=1&orderId=${input.orderId}`,
      });
      return {
        paymentId: session.paypalOrderId,
        gatewayUrl: session.approveUrl,
        provider: 'paypal',
      };
    }
    assertMockPaymentsAllowed();
    const paymentId = `mock-pay-${randomUUID().slice(0, 8)}`;
    return {
      paymentId,
      gatewayUrl: `/mock-gopay/${paymentId}`,
      provider: 'mock-gopay',
    };
  }

  // 'gopay' = card flow → vybereme reálnou bránu podle env + currency
  const providerName = selectProviderName(input.currency);

  const notificationUrl = `${input.appUrl}/api/payments/${providerName}/webhook`;
  const returnUrl = `${input.appUrl}/cs/order-confirmation/${input.orderId}`;

  if (providerName === 'gopay') {
    const cfg = getGopayConfig();
    if (cfg.isConfigured) {
      const session = await createGopaySession({
        orderId: input.orderId,
        amountHalire: input.amountHalire,
        currency: input.currency,
        buyerEmail: input.buyerEmail,
        buyerName: input.buyerName,
        description: input.description,
        notificationUrl,
        returnUrl,
      });
      return {
        paymentId: session.paymentId,
        gatewayUrl: session.gatewayUrl,
        provider: 'gopay',
      };
    }
  }

  if (providerName === 'comgate') {
    const cfg = getComGateConfig();
    if (cfg.isConfigured) {
      const session = await createComGateSession({
        orderId: input.orderId,
        amountHalire: input.amountHalire,
        currency: input.currency,
        buyerEmail: input.buyerEmail,
        buyerName: input.buyerName,
        description: input.description,
        notificationUrl,
        returnUrl,
      });
      return {
        paymentId: session.paymentId,
        gatewayUrl: session.gatewayUrl,
        provider: 'comgate',
      };
    }
  }

  if (providerName === 'stripe' && process.env.STRIPE_SECRET_KEY) {
    const session = await createStripeCheckoutSession({
      orderId: input.orderId,
      amountHalire: input.amountHalire,
      currency: input.currency,
      buyerEmail: input.buyerEmail,
      description: input.description,
      successUrl: returnUrl,
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

  // Mock fallback — žádný provider nakonfigurovaný. V produkci fail-closed.
  assertMockPaymentsAllowed();
  const paymentId = `mock-pay-${randomUUID().slice(0, 8)}`;
  return {
    paymentId,
    gatewayUrl: `/mock-gopay/${paymentId}`,
    provider: 'mock-gopay',
  };
}
