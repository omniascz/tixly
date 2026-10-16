/**
 * Provider-agnostické volání refundu u platební brány (FIX K2).
 *
 * Objednávka drží `payment_provider` + id platby v `gopay_payment_id` (historicky
 * generický sloupec). GoPay i ComGate adaptér mají shodný tvar `(paymentId,
 * amountHalire) -> {ok, raw}`. Bez id platby (comp, POS cash, 0 Kč) není u brány
 * co vracet → ok bez volání.
 */
import { refundGopayPayment } from './gopay-real';
import { refundComGatePayment } from './comgate';

export interface GatewayRefundResult {
  ok: boolean;
  raw: unknown;
  error?: string;
  /** true = u brány se refund nevolal, protože platba přes bránu neexistuje. */
  skipped?: boolean;
}

export async function refundOrderViaGateway(
  order: { payment_provider: string | null; gopay_payment_id: string | null },
  amountHalire: number,
): Promise<GatewayRefundResult> {
  const provider = (order.payment_provider ?? 'gopay').toLowerCase();
  const paymentId = order.gopay_payment_id;

  if (!paymentId) return { ok: true, raw: 'NO_GATEWAY_PAYMENT', skipped: true };

  try {
    if (provider === 'gopay') return await refundGopayPayment(paymentId, amountHalire);
    if (provider === 'comgate') return await refundComGatePayment(paymentId, amountHalire);
    // Mollie/PayPal mají jiný tvar adaptéru (currency + idempotencyKey) a v tomto
    // kole je nezapojuji, aby refund nevypadal otestovaně, když není. Fail hlasitě.
    return { ok: false, raw: null, error: `REFUND_UNSUPPORTED_PROVIDER_${provider}` };
  } catch (err) {
    return { ok: false, raw: null, error: err instanceof Error ? err.message : String(err) };
  }
}
