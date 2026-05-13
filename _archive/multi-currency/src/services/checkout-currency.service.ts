// =============================================================================
// Checkout Currency Service — Multi-Currency Checkout Integration
// Feature #29: Allow buyers to pay in their preferred currency
//
// Flow:
//   1. Buyer selects currency (e.g., EUR, USD, GBP) at checkout
//   2. getCheckoutPrice() converts CZK base price → buyer currency at locked rate
//   3. Lock rate is stored with the order (prevents rate changes mid-checkout)
//   4. Payment provider (Stripe) charged in buyer currency
//   5. Promoter receives CZK equivalent (FX handled by payment gateway)
// =============================================================================

import { convertCurrency, getLatestRate } from './currency.service.js';

export interface CheckoutCurrencyResult {
  baseCurrency: string;
  baseAmountHellers: number;
  targetCurrency: string;
  targetAmountSubunits: number;
  exchangeRate: string;
  rateDate: string;
  rateSource: string;
}

export interface OrderCurrencyRecord {
  orderId: string;
  baseCurrency: string;
  baseAmountHellers: number;
  targetCurrency: string;
  targetAmountSubunits: number;
  exchangeRate: string;
  rateDate: string;
  rateLockedAt: string;
}

export interface DbAdapter {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<void>;
}

const SUPPORTED_CURRENCIES = ['CZK', 'EUR', 'USD', 'GBP', 'PLN', 'HUF', 'SKK'];

/**
 * Get the checkout price for a buyer's preferred currency.
 * Locks the exchange rate at checkout creation time.
 */
export async function getCheckoutPrice(
  baseAmountHellers: number,
  baseCurrency: string = 'CZK',
  targetCurrency: string,
  db: DbAdapter,
): Promise<CheckoutCurrencyResult> {
  const target = targetCurrency.toUpperCase();

  if (!SUPPORTED_CURRENCIES.includes(target)) {
    throw new Error(`VALIDATION_ERROR: unsupported currency ${target}`);
  }

  if (baseAmountHellers <= 0) {
    throw new Error('VALIDATION_ERROR: amount must be positive');
  }

  // Same currency — no conversion needed
  if (baseCurrency.toUpperCase() === target) {
    const today = new Date().toISOString().slice(0, 10);
    return {
      baseCurrency,
      baseAmountHellers,
      targetCurrency: target,
      targetAmountSubunits: baseAmountHellers,
      exchangeRate: '1.00000000',
      rateDate: today,
      rateSource: 'IDENTITY',
    };
  }

  const today = new Date().toISOString().slice(0, 10);

  // Get latest rate
  const latestRate = await getLatestRate(
    { db },
    baseCurrency.toUpperCase(),
    target,
  );

  if (!latestRate) {
    throw new Error(`RATE_NOT_FOUND: no rate available for ${baseCurrency}/${target}`);
  }

  // Convert using currency service
  const conversion = await convertCurrency(
    { db },
    baseAmountHellers,
    baseCurrency.toUpperCase(),
    target,
    latestRate.date,
  );

  return {
    baseCurrency: baseCurrency.toUpperCase(),
    baseAmountHellers,
    targetCurrency: target,
    targetAmountSubunits: conversion.resultSubunits,
    exchangeRate: conversion.rate,
    rateDate: latestRate.date,
    rateSource: latestRate.source,
  };
}

/**
 * Lock the exchange rate for an order at checkout.
 * Records the conversion details for auditing and refunds.
 */
export async function lockOrderCurrency(
  orderId: string,
  conversion: CheckoutCurrencyResult,
  db: DbAdapter,
): Promise<OrderCurrencyRecord> {
  const rows = await db.query<{
    order_id: string;
    base_currency: string;
    base_amount_hellers: number;
    target_currency: string;
    target_amount_subunits: number;
    exchange_rate: string;
    rate_date: string;
    rate_locked_at: string;
  }>(
    `INSERT INTO orders.order_currencies
       (order_id, base_currency, base_amount_hellers, target_currency, target_amount_subunits, exchange_rate, rate_date)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (order_id)
     DO UPDATE SET
       target_currency = $4,
       target_amount_subunits = $5,
       exchange_rate = $6,
       rate_date = $7,
       rate_locked_at = NOW()
     RETURNING *`,
    [
      orderId,
      conversion.baseCurrency,
      conversion.baseAmountHellers,
      conversion.targetCurrency,
      conversion.targetAmountSubunits,
      conversion.exchangeRate,
      conversion.rateDate,
    ],
  );

  if (!rows[0]) throw new Error('INTERNAL_ERROR: order currency lock failed');

  const r = rows[0];
  return {
    orderId: r.order_id,
    baseCurrency: r.base_currency,
    baseAmountHellers: r.base_amount_hellers,
    targetCurrency: r.target_currency,
    targetAmountSubunits: r.target_amount_subunits,
    exchangeRate: r.exchange_rate,
    rateDate: r.rate_date,
    rateLockedAt: r.rate_locked_at,
  };
}

/**
 * Get locked currency for an order (to confirm what was charged).
 */
export async function getOrderCurrency(
  orderId: string,
  db: DbAdapter,
): Promise<OrderCurrencyRecord | null> {
  const rows = await db.query<{
    order_id: string;
    base_currency: string;
    base_amount_hellers: number;
    target_currency: string;
    target_amount_subunits: number;
    exchange_rate: string;
    rate_date: string;
    rate_locked_at: string;
  }>(
    `SELECT * FROM orders.order_currencies WHERE order_id = $1`,
    [orderId],
  );

  if (!rows[0]) return null;
  const r = rows[0];
  return {
    orderId: r.order_id,
    baseCurrency: r.base_currency,
    baseAmountHellers: r.base_amount_hellers,
    targetCurrency: r.target_currency,
    targetAmountSubunits: r.target_amount_subunits,
    exchangeRate: r.exchange_rate,
    rateDate: r.rate_date,
    rateLockedAt: r.rate_locked_at,
  };
}

/**
 * Get list of supported currencies for the UI.
 */
export function getSupportedCurrencies(): string[] {
  return [...SUPPORTED_CURRENCIES];
}

/**
 * Format amount in a target currency for display.
 * Respects currency subunit conventions (JPY has 0 decimals).
 */
export function formatCurrencyDisplay(
  amountSubunits: number,
  currency: string,
): string {
  const subunitsMap: Record<string, number> = {
    CZK: 100,
    EUR: 100,
    USD: 100,
    GBP: 100,
    PLN: 100,
    HUF: 100,
    JPY: 1,
  };

  const subunits = subunitsMap[currency.toUpperCase()] ?? 100;
  const amount = amountSubunits / subunits;
  const decimals = subunits === 1 ? 0 : 2;

  return new Intl.NumberFormat('cs-CZ', {
    style: 'currency',
    currency: currency.toUpperCase(),
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(amount);
}
