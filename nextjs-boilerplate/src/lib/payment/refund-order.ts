/**
 * Sdílený stavový automat refundu objednávky (FIX K2). Jedno místo pravdy pro
 * admin refund i buyer self-refund — „žádná paralelní logika".
 *
 * Invariant: stav `refunded` se nastaví AŽ po potvrzení brány. Tok:
 *   paid/paid_partial/refund_failed
 *        │  (txn1, FOR UPDATE, idempotentní guard)
 *        ▼
 *   refund_pending  ──► volání brány (MIMO transakci) ──►
 *        ├─ ok    → refunded | paid (partial) + revoke/inventář (callback) + uložení odpovědi
 *        └─ chyba → refund_failed + uložení chyby  (HTTP 502, lístky zůstávají)
 *
 * Idempotence: druhý (souběžný) požadavek narazí na `refund_pending`/`refunded`
 * a bránu NEVOLÁ. Po `refund_failed` je povolen retry.
 *
 * Kolo 3 (guard 486): přechody stavu a efekty jsou systémové operace automatu → běží přes
 * asSystemInTx. Vlastnictví / oprávnění (kupec vs. pořadatel) ověřuje VOLAJÍCÍ před voláním.
 */
import type { Pool } from 'pg';
import { refundOrderViaGateway } from './gateway-refund';
import { asSystemInTx } from '@/lib/db/rls-pool';

export interface RefundOrderResult {
  http: number;
  body: Record<string, unknown>;
  /** stav po operaci (pro navazující notifikace v routě) */
  outcome: 'refunded' | 'partial' | 'failed' | 'already' | 'in_progress' | 'invalid';
}

export interface RefundOrderOpts {
  pool: Pool;
  orderId: string;
  /** Kolik se u brány vrací (haléře). Plný refund = total_amount; částečný = suma vrácených lístků. */
  amountHalire: number;
  /** Cílový stav objednávky po úspěchu: 'refunded' (nic nezůstalo valid) nebo 'paid' (částečný). */
  finalStatus: 'refunded' | 'paid';
  /** Efekty v úspěšné transakci: revoke lístků, restore inventáře/sedadel (route-specific). */
  applyEffects: (client: import('pg').PoolClient) => Promise<void>;
  /** Volitelný zápis do audit logu v úspěšné transakci. */
  audit?: (client: import('pg').PoolClient) => Promise<void>;
  /**
   * Kolo 3 / R5: refund už provedla brána sama (webhook REFUNDED — portál brány, chargeback).
   * Bránu NEVOLÁME znovu; přechod + efekty + finální stav proběhnou v JEDNÉ transakci
   * (není mezi nimi síťové volání, takže objednávka nemůže uvíznout v refund_pending).
   * `raw` se uloží do refund_gateway_response.
   */
  gatewayRefundedExternally?: { raw: unknown };
  /** Ze kterých stavů je refund povolen (default paid/paid_partial/refund_failed). */
  allowFromStatuses?: string[];
}

const DEFAULT_REFUNDABLE = ['paid', 'paid_partial', 'refund_failed'];

export async function executeOrderRefund(opts: RefundOrderOpts): Promise<RefundOrderResult> {
  const { pool, orderId, amountHalire, finalStatus, applyEffects, audit } = opts;
  const refundable = opts.allowFromStatuses ?? DEFAULT_REFUNDABLE;

  if (opts.gatewayRefundedExternally) {
    return finalizeExternalRefund(opts, refundable);
  }

  // ── txn1: idempotentní přechod paid → refund_pending ───────────────────────
  const c1 = await pool.connect();
  let order: { status: string; payment_provider: string | null; gopay_payment_id: string | null; total_amount: number };
  try {
    await c1.query('BEGIN');
    const r = await c1.query<{ status: string; payment_provider: string | null; gopay_payment_id: string | null; total_amount: number }>(
      `SELECT status, payment_provider, gopay_payment_id, total_amount
         FROM orders.orders WHERE id = $1 FOR UPDATE`,
      [orderId],
    );
    if (r.rows.length === 0) { await c1.query('ROLLBACK'); return { http: 404, body: { error: 'ORDER_NOT_FOUND' }, outcome: 'invalid' }; }
    order = r.rows[0];

    if (order.status === 'refunded') { await c1.query('ROLLBACK'); return { http: 200, body: { ok: true, alreadyRefunded: true, orderId }, outcome: 'already' }; }
    if (order.status === 'refund_pending') { await c1.query('ROLLBACK'); return { http: 409, body: { error: 'REFUND_IN_PROGRESS', orderId }, outcome: 'in_progress' }; }
    if (!refundable.includes(order.status)) {
      await c1.query('ROLLBACK');
      return { http: 409, body: { error: `Order status is "${order.status}", cannot refund` }, outcome: 'invalid' };
    }

    await asSystemInTx(c1, () => c1.query(
      `UPDATE orders.orders SET status = 'refund_pending', refund_initiated_at = now(),
              refund_error = NULL, updated_at = now() WHERE id = $1`,
      [orderId],
    ));
    await c1.query('COMMIT');
  } catch (e) {
    await c1.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    c1.release();
  }

  // ── volání brány (MIMO transakci — síť) ────────────────────────────────────
  const gw = await refundOrderViaGateway(order, amountHalire);

  // ── txn2: dle výsledku ─────────────────────────────────────────────────────
  const c2 = await pool.connect();
  try {
    await c2.query('BEGIN');
    if (!gw.ok) {
      await asSystemInTx(c2, () => c2.query(
        `UPDATE orders.orders SET status = 'refund_failed', refund_error = $2,
                refund_gateway_response = $3::jsonb, updated_at = now() WHERE id = $1`,
        [orderId, gw.error ?? 'GATEWAY_REFUND_FAILED', JSON.stringify(gw.raw ?? null)],
      ));
      await c2.query('COMMIT');
      return { http: 502, body: { error: 'REFUND_GATEWAY_FAILED', message: gw.error ?? 'Platební brána refund odmítla.', orderId }, outcome: 'failed' };
    }

    await asSystemInTx(c2, async () => {
      await applyEffects(c2);
      await c2.query(
        `UPDATE orders.orders
            SET status = $2, refund_completed_at = now(),
                refunded_amount_halire = $3,
                refund_gateway_response = $4::jsonb, refund_error = NULL, updated_at = now()
          WHERE id = $1`,
        [orderId, finalStatus, amountHalire, JSON.stringify(gw.raw ?? null)],
      );
    });
    if (audit) await audit(c2);
    await c2.query('COMMIT');
    return {
      http: 200,
      body: { ok: true, orderId, refundedAmountHalire: amountHalire, gatewaySkipped: gw.skipped ?? false },
      outcome: finalStatus === 'refunded' ? 'refunded' : 'partial',
    };
  } catch (e) {
    await c2.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    c2.release();
  }
}

/**
 * Refund provedený bránou mimo Tixly: stejný stavový automat a tytéž efekty jako
 * executeOrderRefund, ale bez volání brány a v jedné transakci.
 * - `refunded` → already (idempotence opakovaného webhooku),
 * - `refund_pending` → in_progress: běží refund z Tixly, jeho txn2 aplikuje efekty;
 *   kdybychom je aplikovali i tady, kapacita by se vrátila dvakrát.
 */
async function finalizeExternalRefund(opts: RefundOrderOpts, refundable: string[]): Promise<RefundOrderResult> {
  const { pool, orderId, amountHalire, finalStatus, applyEffects, audit } = opts;
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const r = await c.query<{ status: string }>(`SELECT status FROM orders.orders WHERE id = $1 FOR UPDATE`, [orderId]);
    if (r.rows.length === 0) { await c.query('ROLLBACK'); return { http: 404, body: { error: 'ORDER_NOT_FOUND' }, outcome: 'invalid' }; }
    const status = r.rows[0].status;
    if (status === 'refunded') { await c.query('ROLLBACK'); return { http: 200, body: { ok: true, alreadyRefunded: true, orderId }, outcome: 'already' }; }
    if (status === 'refund_pending') { await c.query('ROLLBACK'); return { http: 409, body: { error: 'REFUND_IN_PROGRESS', orderId }, outcome: 'in_progress' }; }
    if (!refundable.includes(status)) {
      await c.query('ROLLBACK');
      return { http: 409, body: { error: `Order status is "${status}", cannot refund` }, outcome: 'invalid' };
    }
    await asSystemInTx(c, async () => {
      await applyEffects(c);
      await c.query(
        `UPDATE orders.orders
            SET status = $2, refund_initiated_at = COALESCE(refund_initiated_at, now()), refund_completed_at = now(),
                refunded_amount_halire = $3,
                refund_gateway_response = $4::jsonb, refund_error = NULL, updated_at = now()
          WHERE id = $1`,
        [orderId, finalStatus, amountHalire, JSON.stringify(opts.gatewayRefundedExternally?.raw ?? null)],
      );
    });
    if (audit) await audit(c);
    await c.query('COMMIT');
    return {
      http: 200,
      body: { ok: true, orderId, refundedAmountHalire: amountHalire, gatewayRefundedExternally: true },
      outcome: finalStatus === 'refunded' ? 'refunded' : 'partial',
    };
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}
