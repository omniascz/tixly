import { BankReconciliationError } from '../lib/bank-errors.js';
import { buildSpaydString, generateSpaydQr } from '../lib/spayd-generator.js';
import type { ServiceDeps } from '../lib/service-container.js';
import type {
  BankPaymentMatchStatus,
  BankPaymentRecord,
  FioTransaction,
  SpaydQrInput,
  SpaydQrResult,
} from '../types/bank.js';
import { applyMatch } from './payment-matching.js';

interface BankPaymentRow {
  id: string;
  fio_transaction_id: string;
  amount_halire: number;
  currency: string;
  variable_symbol: string | null;
  constant_symbol: string | null;
  specific_symbol: string | null;
  counter_account: string | null;
  counter_account_name: string | null;
  message: string | null;
  order_id: string | null;
  match_status: BankPaymentMatchStatus;
  raw_payload: Record<string, unknown> | null;
  received_at: Date | string;
  matched_at: Date | string | null;
}

function rowToRecord(row: BankPaymentRow): BankPaymentRecord {
  return {
    id: row.id,
    fioTransactionId: row.fio_transaction_id,
    amountHalire: Number(row.amount_halire),
    currency: row.currency,
    variableSymbol: row.variable_symbol,
    orderId: row.order_id,
    matchStatus: row.match_status,
    receivedAt: row.received_at instanceof Date ? row.received_at : new Date(row.received_at),
    matchedAt: row.matched_at
      ? row.matched_at instanceof Date
        ? row.matched_at
        : new Date(row.matched_at)
      : null,
    rawPayload: row.raw_payload ?? {},
  };
}

export async function findUnpaidOrderByVariableSymbol(
  vs: string,
  deps: ServiceDeps,
): Promise<{ orderId: string; expectedAmountHalire: number } | null> {
  if (!vs) return null;
  const rows = await deps.db.query<{ id: string; total_halire: number | string }>(
    `SELECT id, total_halire
       FROM orders.orders
      WHERE variable_symbol = $1
        AND status IN ('pending', 'awaiting_payment')
      ORDER BY created_at ASC
      LIMIT 1`,
    [vs],
  );
  if (rows.length === 0) return null;
  return {
    orderId: rows[0].id,
    expectedAmountHalire: Number(rows[0].total_halire),
  };
}

async function insertBankPayment(
  tx: FioTransaction,
  deps: ServiceDeps,
): Promise<BankPaymentRecord | null> {
  // Idempotent insert — UNIQUE on fio_transaction_id
  const rows = await deps.db.query<BankPaymentRow>(
    `INSERT INTO payments.bank_payments (
       fio_transaction_id, amount_halire, currency,
       variable_symbol, constant_symbol, specific_symbol,
       counter_account, counter_account_name, message,
       match_status, raw_payload, received_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     ON CONFLICT (fio_transaction_id) DO NOTHING
     RETURNING *`,
    [
      tx.id,
      tx.amountHalire,
      tx.currency,
      tx.variableSymbol,
      tx.constantSymbol,
      tx.specificSymbol,
      tx.counterAccount,
      tx.counterAccountName,
      tx.message,
      'unmatched',
      JSON.stringify(tx),
      tx.date ? new Date(tx.date) : new Date(),
    ],
  );
  if (rows.length === 0) return null;
  return rowToRecord(rows[0]);
}

async function updatePaymentStatus(
  paymentId: string,
  status: BankPaymentMatchStatus,
  orderId: string | null,
  deps: ServiceDeps,
): Promise<void> {
  await deps.db.execute(
    `UPDATE payments.bank_payments
        SET match_status = $1,
            order_id = $2,
            matched_at = CASE WHEN $1 = 'matched' THEN NOW() ELSE matched_at END
      WHERE id = $3`,
    [status, orderId, paymentId],
  );
}

async function markOrderPaid(
  orderId: string,
  bankPaymentId: string,
  deps: ServiceDeps,
): Promise<void> {
  await deps.db.execute(
    `UPDATE orders.orders
        SET status = 'paid', paid_at = NOW()
      WHERE id = $1 AND status IN ('pending', 'awaiting_payment')`,
    [orderId],
  );
  // NOTE: Kafka emit kept here only for the manual-match path (not called from pollAndReconcile).
  await deps.kafka.send('order.paid', {
    orderId,
    bankPaymentId,
    paidAt: new Date().toISOString(),
  });
}

export async function pollAndReconcile(
  deps: ServiceDeps,
): Promise<{
  fetched: number;
  matched: number;
  unmatched: number;
  errors: number;
}> {
  if (!deps.fioConfig.isConfigured) {
    console.log('[bank-reconciliation] Fio not configured, skipping poll');
    return { fetched: 0, matched: 0, unmatched: 0, errors: 0 };
  }

  const transactions = await deps.fioClient.fetchNewTransactions();

  let matched = 0;
  let unmatched = 0;
  let errors = 0;

  for (const tx of transactions) {
    if (tx.type !== 'PRIJEM') continue;
    try {
      const record = await insertBankPayment(tx, deps);
      if (!record) continue; // duplicate — already processed

      const order = tx.variableSymbol
        ? await findUnpaidOrderByVariableSymbol(tx.variableSymbol, deps)
        : null;

      if (order) {
        if (tx.amountHalire === order.expectedAmountHalire) {
          await updatePaymentStatus(record.id, 'matched', order.orderId, deps);
          await deps.kafka.send('order.paid', {
            orderId: order.orderId,
            bankPaymentId: record.id,
            paidAt: new Date().toISOString(),
          });
          matched++;
        } else if (tx.amountHalire > order.expectedAmountHalire) {
          await updatePaymentStatus(record.id, 'overpaid', order.orderId, deps);
          unmatched++;
        } else {
          unmatched++;
        }
      } else {
        unmatched++;
      }
    } catch (err) {
      console.error('[bank-reconciliation] Error processing transaction', tx.id, err);
      errors++;
    }
  }

  return { fetched: transactions.length, matched, unmatched, errors };
}

export async function manualMatchPayment(
  bankPaymentId: string,
  orderId: string,
  adminUserId: string,
  deps: ServiceDeps,
): Promise<BankPaymentRecord> {
  const rows = await deps.db.query<BankPaymentRow>(
    `SELECT * FROM payments.bank_payments WHERE id = $1`,
    [bankPaymentId],
  );
  if (rows.length === 0) {
    throw new BankReconciliationError('PAYMENT_NOT_FOUND', { bankPaymentId });
  }

  const payment = rows[0];
  const amountHalire = Number(payment.amount_halire);

  // Look up order to get expected amount for audit
  const orderRows = await deps.db.query<{ total_halire: number | string }>(
    `SELECT total_halire FROM orders.orders WHERE id = $1`,
    [orderId],
  );
  const expectedAmount = orderRows.length > 0 ? Number(orderRows[0].total_halire) : amountHalire;

  // Use applyMatch for consistent audit logging + transactional update
  await applyMatch(
    deps.db,
    bankPaymentId,
    orderId,
    {
      orderId,
      variableSymbol: payment.variable_symbol,
      expectedAmountHalire: expectedAmount,
      currency: payment.currency,
      matchLevel: 1, // manual matches logged as level 1
      matchScore: 1.0,
      matchReasons: [`Manual match by admin ${adminUserId}`],
    },
    amountHalire,
    adminUserId,
  );

  // Re-read after update
  const updated = await deps.db.query<BankPaymentRow>(
    `SELECT * FROM payments.bank_payments WHERE id = $1`,
    [bankPaymentId],
  );

  if (updated.length === 0) {
    throw new BankReconciliationError('MATCH_FAILED', { bankPaymentId });
  }

  await deps.kafka.send('bank.payment.manually_matched', {
    bankPaymentId,
    orderId,
    adminUserId,
    matchedAt: new Date().toISOString(),
  });

  return rowToRecord(updated[0]);
}

export async function listUnmatchedPayments(
  deps: ServiceDeps,
  pagination: { limit?: number; offset?: number },
): Promise<{ items: BankPaymentRecord[]; total: number }> {
  const limit = Math.min(Math.max(pagination.limit ?? 50, 1), 500);
  const offset = Math.max(pagination.offset ?? 0, 0);

  const items = await deps.db.query<BankPaymentRow>(
    `SELECT * FROM payments.bank_payments
      WHERE match_status IN ('unmatched', 'overpaid', 'underpaid', 'manual_review')
      ORDER BY received_at DESC
      LIMIT $1 OFFSET $2`,
    [limit, offset],
  );

  const totalRows = await deps.db.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
       FROM payments.bank_payments
      WHERE match_status IN ('unmatched', 'overpaid', 'underpaid', 'manual_review')`,
  );

  return {
    items: items.map(rowToRecord),
    total: Number(totalRows[0]?.count ?? 0),
  };
}

export async function generatePaymentQr(
  input: SpaydQrInput,
  deps: ServiceDeps,
): Promise<SpaydQrResult> {
  // buildSpaydString is called inside generateSpaydQr, but we re-validate here for early error
  buildSpaydString(deps.spaydConfig, input);
  return generateSpaydQr(deps.spaydConfig, input);
}
