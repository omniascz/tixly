// =============================================================================
// Wero Payment Service
//
// SCHEMA (migrations/236_wero_payments.sql):
//
//   CREATE TABLE payments.wero_payments (
//     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
//     order_id TEXT NOT NULL,
//     promoter_id TEXT NOT NULL,
//     status TEXT NOT NULL,
//     external_id TEXT UNIQUE,
//     amount_halire INTEGER NOT NULL,
//     iban_hash TEXT,  -- AES-256 encrypted for GDPR compliance
//     initiated_at TIMESTAMPTZ DEFAULT NOW(),
//     authorized_at TIMESTAMPTZ,
//     confirmed_at TIMESTAMPTZ,
//     error_code TEXT,
//     error_message TEXT,
//     created_at TIMESTAMPTZ DEFAULT NOW(),
//     updated_at TIMESTAMPTZ DEFAULT NOW()
//   );
//
//   CREATE TABLE payments.wero_webhooks (
//     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
//     payment_id UUID REFERENCES wero_payments(id),
//     event_type TEXT NOT NULL,
//     status TEXT,
//     raw_payload JSONB,
//     signature_valid BOOLEAN,
//     processed_at TIMESTAMPTZ DEFAULT NOW()
//   );
//
// Všechny částky jsou INTEGER haléře (1 Kč = 100 haléřů).
// =============================================================================

import crypto from 'crypto';
import type { Database } from '@tixly/database';
import type { WeroHttpClient } from '../lib/wero-client.js';
import { WeroError } from '../lib/wero-errors.js';
import type {
  WeroPayment,
  WeroPaymentStatus,
  WeroInitiateRequest,
  WeroInitiateResponse,
  WeroStatsResponse,
} from '../types/wero.js';

interface WeroPaymentRow {
  id: string;
  order_id: string;
  promoter_id: string;
  status: string;
  external_id: string | null;
  amount_halire: number;
  iban_hash: string | null;
  initiated_at: string;
  authorized_at: string | null;
  confirmed_at: string | null;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

function rowToPayment(row: WeroPaymentRow): WeroPayment {
  return {
    id: row.id,
    orderId: row.order_id,
    status: row.status as WeroPaymentStatus,
    externalId: row.external_id ?? '',
    amountHalire: row.amount_halire,
    ibanHash: row.iban_hash ?? '',
    initiatedAt: row.initiated_at,
    authorizedAt: row.authorized_at ?? undefined,
    confirmedAt: row.confirmed_at ?? undefined,
  };
}

interface ServiceDeps {
  db: Database;
  weroClient: WeroHttpClient;
}

// ---------------------------------------------------------------------------
// initiateWeroPayment — Create payment record + call Wero API
// ---------------------------------------------------------------------------
export async function initiateWeroPayment(
  orderId: string,
  promoterId: string,
  amountHalire: number,
  returnUrl: string,
  deps: ServiceDeps,
): Promise<WeroInitiateResponse> {
  const { db, weroClient } = deps;

  if (!Number.isInteger(amountHalire) || amountHalire <= 0) {
    throw new WeroError('WERO_INVALID_AMOUNT');
  }

  // Call Wero API to get redirect URL
  const weroResult = await weroClient.initiatePayment(orderId, amountHalire, returnUrl);

  // Store payment record in DB (transactional)
  const payment = await db.transaction(async (tx) => {
    const [inserted] = await tx.query<WeroPaymentRow>(
      `INSERT INTO payments.wero_payments
         (order_id, promoter_id, status, external_id, amount_halire, iban_hash)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [orderId, promoterId, 'initiated', weroResult.paymentId, amountHalire, null],
    );

    if (!inserted) {
      throw new WeroError('WERO_API_ERROR', 'Nepodařilo se uložit platbu do DB.');
    }

    return rowToPayment(inserted);
  });

  return {
    redirectUrl: weroResult.redirectUrl,
    paymentId: payment.id,
  };
}

// ---------------------------------------------------------------------------
// confirmPayment — Update status to confirmed + trigger order-completed webhook
// ---------------------------------------------------------------------------
export async function confirmPayment(
  paymentId: string,
  orderId: string,
  db: Database,
): Promise<WeroPayment> {
  const [payment] = await db.query<WeroPaymentRow>(
    `UPDATE payments.wero_payments
       SET status = $1, confirmed_at = NOW(), updated_at = NOW()
     WHERE id = $2 OR external_id = $2
     RETURNING *`,
    ['confirmed', paymentId],
  );

  if (!payment) {
    throw new WeroError('WERO_PAYMENT_NOT_FOUND');
  }

  return rowToPayment(payment);
}

// ---------------------------------------------------------------------------
// updatePaymentStatus — Update status + set corresponding timestamp
// ---------------------------------------------------------------------------
export async function updatePaymentStatus(
  paymentId: string,
  status: WeroPaymentStatus,
  errorCode?: string,
  errorMessage?: string,
  db?: Database,
): Promise<WeroPayment> {
  if (!db) {
    throw new WeroError('WERO_INVALID_ARGUMENT', 'Database instance required');
  }

  const updateFields: string[] = ['status = $1', 'updated_at = NOW()'];
  const params: unknown[] = [status];
  let paramIndex = 2;

  if (status === 'authorized') {
    updateFields.push(`authorized_at = NOW()`);
  } else if (status === 'confirmed') {
    updateFields.push(`confirmed_at = NOW()`);
  } else if (status === 'failed') {
    updateFields.push(`error_code = $${paramIndex}`, `error_message = $${paramIndex + 1}`);
    params.push(errorCode ?? null, errorMessage ?? null);
    paramIndex += 2;
  }

  params.push(paymentId);

  const [updated] = await db.query<WeroPaymentRow>(
    `UPDATE payments.wero_payments
       SET ${updateFields.join(', ')}
     WHERE id = $${paramIndex} OR external_id = $${paramIndex}
     RETURNING *`,
    params,
  );

  if (!updated) {
    throw new WeroError('WERO_PAYMENT_NOT_FOUND');
  }

  return rowToPayment(updated);
}

// ---------------------------------------------------------------------------
// getPaymentForOrder — Fetch latest Wero payment for order
// ---------------------------------------------------------------------------
export async function getPaymentForOrder(orderId: string, db: Database): Promise<WeroPayment> {
  const [row] = await db.query<WeroPaymentRow>(
    `SELECT * FROM payments.wero_payments WHERE order_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [orderId],
  );

  if (!row) {
    throw new WeroError('WERO_PAYMENT_NOT_FOUND');
  }

  return rowToPayment(row);
}

// ---------------------------------------------------------------------------
// cancelPayment — Mark payment as failed + potentially trigger refund
// ---------------------------------------------------------------------------
export async function cancelPayment(paymentId: string, db: Database): Promise<WeroPayment> {
  const [payment] = await db.query<WeroPaymentRow>(
    `UPDATE payments.wero_payments
       SET status = $1, updated_at = NOW()
     WHERE id = $2 OR external_id = $2
     RETURNING *`,
    ['failed', paymentId],
  );

  if (!payment) {
    throw new WeroError('WERO_PAYMENT_NOT_FOUND');
  }

  // TODO: Trigger refund if already authorized

  return rowToPayment(payment);
}

// ---------------------------------------------------------------------------
// getWeroStats — Get payment statistics for promoter
// ---------------------------------------------------------------------------
export async function getWeroStats(promoterId: string, db: Database): Promise<WeroStatsResponse> {
  const [stats] = await db.query<{
    successful_count: number;
    total_volume: number;
    avg_amount: number;
  }>(
    `SELECT
       COUNT(*) as successful_count,
       COALESCE(SUM(amount_halire), 0) as total_volume,
       COALESCE(ROUND(AVG(amount_halire)), 0) as avg_amount
     FROM payments.wero_payments
     WHERE promoter_id = $1 AND status = 'confirmed'`,
    [promoterId],
  );

  return {
    promoterId,
    successfulPaymentsCount: Number(stats?.successful_count ?? 0),
    totalVolumeHalire: Number(stats?.total_volume ?? 0),
    averageAmountHalire: Number(stats?.avg_amount ?? 0),
  };
}

// ---------------------------------------------------------------------------
// logWebhookEvent — Record webhook delivery for audit
// ---------------------------------------------------------------------------
export async function logWebhookEvent(
  paymentId: string,
  eventType: string,
  status: string | undefined,
  rawPayload: unknown,
  signatureValid: boolean,
  db: Database,
): Promise<void> {
  const [payment] = await db.query<{ id: string }>(
    `SELECT id FROM payments.wero_payments WHERE external_id = $1 LIMIT 1`,
    [paymentId],
  );

  if (!payment) {
    throw new WeroError('WERO_PAYMENT_NOT_FOUND');
  }

  await db.query(
    `INSERT INTO payments.wero_webhooks
       (payment_id, event_type, status, raw_payload, signature_valid)
     VALUES ($1, $2, $3, $4, $5)`,
    [payment.id, eventType, status ?? null, JSON.stringify(rawPayload), signatureValid],
  );
}
