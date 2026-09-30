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
 */
import type { Pool } from 'pg';
import { refundOrderViaGateway } from './gateway-refund';

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
}

export async function executeOrderRefund(opts: RefundOrderOpts): Promise<RefundOrderResult> {
  const { pool, orderId, amountHalire, finalStatus, applyEffects, audit } = opts;

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
    if (!['paid', 'paid_partial', 'refund_failed'].includes(order.status)) {
      await c1.query('ROLLBACK');
      return { http: 409, body: { error: `Order status is "${order.status}", cannot refund` }, outcome: 'invalid' };
    }

    await c1.query(
      `UPDATE orders.orders SET status = 'refund_pending', refund_initiated_at = now(),
              refund_error = NULL, updated_at = now() WHERE id = $1`,
      [orderId],
    );
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
      await c2.query(
        `UPDATE orders.orders SET status = 'refund_failed', refund_error = $2,
                refund_gateway_response = $3::jsonb, updated_at = now() WHERE id = $1`,
        [orderId, gw.error ?? 'GATEWAY_REFUND_FAILED', JSON.stringify(gw.raw ?? null)],
      );
      await c2.query('COMMIT');
      return { http: 502, body: { error: 'REFUND_GATEWAY_FAILED', message: gw.error ?? 'Platební brána refund odmítla.', orderId }, outcome: 'failed' };
    }

    await applyEffects(c2);
    await c2.query(
      `UPDATE orders.orders
          SET status = $2, refund_completed_at = now(),
              refunded_amount_halire = $3,
              refund_gateway_response = $4::jsonb, refund_error = NULL, updated_at = now()
        WHERE id = $1`,
      [orderId, finalStatus, amountHalire, JSON.stringify(gw.raw ?? null)],
    );
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
