/**
 * Payment provider switcher.
 *
 * Tixly používá pro CZ + SK primárně **GoPay** nebo **ComGate** — tým si vybere
 * podle nejlepších podmínek (provize, settlement, podpora). Stripe je parked
 * pro budoucí mezinárodní expanzi (Větev B).
 *
 * ENV switching:
 *   PAYMENT_PROVIDER=gopay|comgate|stripe|mock   — globální default
 *   PAYMENT_PROVIDER_EUR=gopay|comgate           — explicit override pro EUR
 *
 * Když je GoPay/ComGate vybraná ale chybí povinné credentials, padá to do
 * mock režimu s console.warn — checkout funguje (přesměruje na /mock-gopay/[id]).
 *
 * Wero / Przelewy24 zůstávají mock dokud nedostanou samostatnou integraci.
 */

import { randomUUID } from 'crypto';
import { createComGateSession, getComGateConfig } from './comgate';
import { createGopaySession, getGopayConfig } from './gopay-real';
import { createStripeCheckoutSession } from './stripe';
import { assertMockPaymentsAllowed } from './mock-guard';

export interface CreatePaymentInput {
  orderId: string;
  amountHalire: number;
  currency: string;
  buyerEmail: string;
  buyerName?: string;
  description: string;
  paymentMethod: 'gopay' | 'wero' | 'przelewy24' | 'bank_transfer';
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
    | 'bank_transfer';
  paymentIntentId?: string | null;
}

type ProviderName = 'gopay' | 'comgate' | 'stripe' | 'mock';

function selectProviderName(currency: string): ProviderName {
  if (currency === 'EUR' && process.env.PAYMENT_PROVIDER_EUR) {
    return process.env.PAYMENT_PROVIDER_EUR as ProviderName;
  }
  return (process.env.PAYMENT_PROVIDER ?? 'mock') as ProviderName;
}

/**
 * Vytvoří payment session pro daný order. Volá se z checkout endpointu po commit
 * základní objednávky (status='pending'). Vrácený gatewayUrl je redirect target.
 *
 * Routing podle paymentMethod:
 *   gopay (= karta default)  → selectProviderName(currency) — GoPay/ComGate/Stripe/mock
 *   wero                     → mock-wero (zatím)
 *   przelewy24               → mock-przelewy24 (zatím)
 *   bank_transfer            → confirmation page s VS
 */
export async function createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
  // Bank transfer = žádný redirect na bránu, kupec dostane VS a bankovní účet
  if (input.paymentMethod === 'bank_transfer') {
    const paymentId = `bank-${randomUUID().slice(0, 8)}`;
    return {
      paymentId,
      gatewayUrl: `${input.appUrl}/cs/order-confirmation/${input.orderId}?awaiting=bank_transfer`,
      provider: 'bank_transfer',
    };
  }

  // Wero/Przelewy24 zatím mock (vlastní integrace plánovaná) — v produkci fail-closed.
  if (input.paymentMethod === 'wero') {
    assertMockPaymentsAllowed();
    const paymentId = `mock-pay-${randomUUID().slice(0, 8)}`;
    return {
      paymentId,
      gatewayUrl: `/mock-wero/${paymentId}`,
      provider: 'mock-wero',
    };
  }
  if (input.paymentMethod === 'przelewy24') {
    assertMockPaymentsAllowed();
    const paymentId = `mock-pay-${randomUUID().slice(0, 8)}`;
    return {
      paymentId,
      gatewayUrl: `/mock-przelewy24/${paymentId}`,
      provider: 'mock-przelewy24',
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
    // Není-li GoPay nakonfigurované, spadne do mock
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
    // Není-li ComGate nakonfigurované, spadne do mock
  }

  if (providerName === 'stripe' && process.env.STRIPE_SECRET_KEY) {
    // Parked pro mezinárodní expanzi — Stripe stack zůstává v lib/payment/stripe.ts
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

  // Mock fallback — žádný provider nakonfigurovaný. V produkci fail-closed (jinak
  // by checkout mintoval vstupenky zdarma přes mock-gopay).
  assertMockPaymentsAllowed();
  const paymentId = `mock-pay-${randomUUID().slice(0, 8)}`;
  return {
    paymentId,
    gatewayUrl: `/mock-gopay/${paymentId}`,
    provider: 'mock-gopay',
  };
}
