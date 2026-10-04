/**
 * Politika platebních bran (kolo 7, krok 6).
 *
 * Refund přes API umí jen GoPay a ComGate (gateway-refund.ts). Brány níže peníze přijmou, ale vrátit
 * je přes API neumíme → pro NOVÉ akce nejsou. Akce, které existovaly před migrací 499, mají
 * catalog.events.legacy_payment_gateways = true a fungují beze změny.
 */
import { NextResponse } from 'next/server';
import { selectProviderName } from './provider';

/** Cokoli s query() — pool (db()) i klient v transakci. */
interface Q {
  query<R extends Record<string, unknown> = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: R[] }>;
}

/** Brány bez refundu přes API (klíč = metoda v checkoutu nebo provider). */
export const NON_REFUNDABLE_GATEWAYS: Record<string, string> = {
  stripe: 'Stripe',
  mollie: 'Mollie',
  paypal: 'PayPal',
  przelewy24: 'Przelewy24',
  crypto: 'Triple-A (krypto)',
};

/**
 * Brána, kterou by platba skutečně použila: metoda kupce (mollie/paypal/przelewy24/crypto), jinak
 * provider z konfigurace podle měny (EUR se Stripe klíčem → Stripe).
 */
export function effectiveGateway(paymentMethod: string, currency: string): string {
  if (paymentMethod in NON_REFUNDABLE_GATEWAYS) return paymentMethod;
  if (paymentMethod === 'gopay') return selectProviderName(currency);
  return paymentMethod;
}

export async function eventAllowsNonRefundableGateways(q: Q, eventId: string): Promise<boolean> {
  const r = await q.query<{ legacy: boolean }>(
    `SELECT legacy_payment_gateways AS legacy FROM catalog.events WHERE id = $1`,
    [eventId],
  );
  return r.rows[0]?.legacy === true;
}

/**
 * null = brána je pro akci povolená. Jinak odpověď (bez založení objednávky).
 * `status` 503 pro mobilní aplikaci (na 503 přepne na webový checkout), jinak 422.
 */
export async function gatewayNotAllowedResponse(
  q: Q,
  eventId: string,
  gateway: string,
  status: 422 | 503 = 422,
): Promise<Response | null> {
  if (!(gateway in NON_REFUNDABLE_GATEWAYS)) return null;
  if (!/^[0-9a-f-]{36}$/i.test(eventId)) return null; // neplatné ID odmítne validace routy
  if (await eventAllowsNonRefundableGateways(q, eventId)) return null;
  return NextResponse.json(
    {
      error: 'PAYMENT_METHOD_NOT_ALLOWED',
      message: `Platba přes ${NON_REFUNDABLE_GATEWAYS[gateway]} není u této akce dostupná. Zvolte prosím platbu kartou nebo převodem.`,
      gateway,
    },
    { status },
  );
}
