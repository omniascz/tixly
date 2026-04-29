// =============================================================================
// Przelewy24 — polská platební brána
//
// Flow:
//   1. createTransaction  — zaregistruje transakci u P24, vrátí redirect URL
//   2. Kupující zaplatí na P24 stránce
//   3. P24 pošle webhook (IPN) → handleWebhook ověří podpis + zavolá verifyPayment
//   4. verifyPayment       — potvrdí platbu na P24 API
//   5. getTransaction      — vrátí stav transakce
//   6. refundPayment       — vrátí platbu (partial/full)
//
// Auth: Basic Auth (posId + apiKey) na REST API
// Podpisy: SHA384 HMAC přes JSON pole klíčů
// Docs: https://developers.przelewy24.pl/
// =============================================================================

import { createHash } from 'crypto';
import type {
  P24Config,
  P24Transaction,
  P24WebhookPayload,
  DbAdapter,
  HttpClient,
} from '../lib/types.js';
import {
  P24Error,
  P24TransactionNotFoundError,
  P24SignatureError,
  P24PaymentFailedError,
} from '../lib/types.js';

// ---------------------------------------------------------------------------
// DB row types
// ---------------------------------------------------------------------------

interface TransactionRow {
  session_id: string;
  token: string;
  redirect_url: string;
  amount: number;
  currency: string;
  status: string;
  p24_order_id: string | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getApiBase(sandbox: boolean): string {
  return sandbox
    ? 'https://sandbox.przelewy24.pl'
    : 'https://secure.przelewy24.pl';
}

function basicAuth(posId: number, apiKey: string): string {
  return `Basic ${Buffer.from(`${posId}:${apiKey}`).toString('base64')}`;
}

function mapRow(row: TransactionRow): P24Transaction {
  return {
    sessionId: row.session_id,
    token: row.token,
    redirectUrl: row.redirect_url,
    amount: row.amount,
    currency: 'PLN',
    status: row.status as P24Transaction['status'],
    p24OrderId: row.p24_order_id,
    createdAt: row.created_at,
  };
}

// ---------------------------------------------------------------------------
// Signature helpers
// ---------------------------------------------------------------------------

/**
 * SHA384 podpis pro registraci transakce.
 * sign = SHA384(JSON({ sessionId, merchantId, amount, currency, crc }))
 */
export function signTransaction(
  sessionId: string,
  merchantId: number,
  amount: number,
  currency: string,
  crc: string,
): string {
  const payload = JSON.stringify({ sessionId, merchantId, amount, currency, crc });
  return createHash('sha384').update(payload).digest('hex');
}

/**
 * SHA384 podpis pro ověření webhooku.
 * sign = SHA384(JSON({ merchantId, posId, sessionId, amount, originAmount, currency, orderId, methodId, statement, crc }))
 */
export function signWebhook(payload: P24WebhookPayload, crc: string): string {
  const data = JSON.stringify({
    merchantId: payload.merchantId,
    posId: payload.posId,
    sessionId: payload.sessionId,
    amount: payload.amount,
    originAmount: payload.originAmount,
    currency: payload.currency,
    orderId: payload.orderId,
    methodId: payload.methodId,
    statement: payload.statement,
    crc,
  });
  return createHash('sha384').update(data).digest('hex');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Zaregistruje novou transakci u Przelewy24.
 * Vrátí redirect URL kam přesměrovat kupujícího.
 */
export async function createTransaction(
  sessionId: string,
  amountGrosze: number,
  description: string,
  email: string,
  config: P24Config,
  db: DbAdapter,
  http: HttpClient,
): Promise<P24Transaction> {
  const sign = signTransaction(sessionId, config.merchantId, amountGrosze, 'PLN', config.reportKey);

  const body = {
    merchantId: config.merchantId,
    posId: config.posId,
    sessionId,
    amount: amountGrosze,
    currency: 'PLN',
    description,
    email,
    country: 'PL',
    language: 'pl',
    urlReturn: config.returnUrl,
    urlStatus: config.notifyUrl,
    sign,
  };

  const apiBase = getApiBase(config.sandbox);
  const headers = {
    Authorization: basicAuth(config.posId, config.apiKey),
    'Content-Type': 'application/json',
  };

  interface RegisterResponse { data: { token: string } }
  const resp = await http.post<RegisterResponse>(
    `${apiBase}/api/v1/transaction/register`,
    body,
    headers,
  );

  const token = resp.data.token;
  const redirectUrl = `${apiBase}/trnRequest/${token}`;

  await db.execute(
    `INSERT INTO przelewy24.transactions
       (session_id, token, redirect_url, amount, currency, status, p24_order_id)
     VALUES ($1, $2, $3, $4, 'PLN', 'pending', NULL)`,
    [sessionId, token, redirectUrl, amountGrosze],
  );

  const rows = await db.query<TransactionRow>(
    `SELECT * FROM przelewy24.transactions WHERE session_id = $1`,
    [sessionId],
  );

  return mapRow(rows[0]);
}

/**
 * Ověří webhook podpis a potvrdí platbu na P24 API.
 * Volá se z POST /api/payments/przelewy24/notify.
 */
export async function handleWebhook(
  payload: P24WebhookPayload,
  config: P24Config,
  db: DbAdapter,
  http: HttpClient,
): Promise<P24Transaction> {
  // Ověř podpis
  const expected = signWebhook(payload, config.reportKey);
  if (expected !== payload.sign) {
    throw new P24SignatureError();
  }

  // Ověř platbu na P24 API (verify)
  const verifySign = createHash('sha384')
    .update(JSON.stringify({
      merchantId: config.merchantId,
      posId: config.posId,
      sessionId: payload.sessionId,
      amount: payload.amount,
      currency: payload.currency,
      orderId: payload.orderId,
      crc: config.reportKey,
    }))
    .digest('hex');

  const apiBase = getApiBase(config.sandbox);
  const headers = {
    Authorization: basicAuth(config.posId, config.apiKey),
    'Content-Type': 'application/json',
  };

  interface VerifyResponse { data: { status: string } }
  const verifyResp = await http.put<VerifyResponse>(
    `${apiBase}/api/v1/transaction/verify`,
    {
      merchantId: config.merchantId,
      posId: config.posId,
      sessionId: payload.sessionId,
      amount: payload.amount,
      currency: payload.currency,
      orderId: payload.orderId,
      sign: verifySign,
    },
    headers,
  );

  const verified = verifyResp.data.status === 'success';

  await db.execute(
    `UPDATE przelewy24.transactions
     SET status = $1, p24_order_id = $2, updated_at = NOW()
     WHERE session_id = $3`,
    [verified ? 'completed' : 'failed', String(payload.orderId), payload.sessionId],
  );

  const rows = await db.query<TransactionRow>(
    `SELECT * FROM przelewy24.transactions WHERE session_id = $1`,
    [payload.sessionId],
  );

  if (!rows[0]) throw new P24TransactionNotFoundError(payload.sessionId);

  if (!verified) throw new P24PaymentFailedError(payload.sessionId);

  return mapRow(rows[0]);
}

/**
 * Vrátí stav transakce z DB.
 */
export async function getTransaction(
  sessionId: string,
  db: DbAdapter,
): Promise<P24Transaction> {
  const rows = await db.query<TransactionRow>(
    `SELECT * FROM przelewy24.transactions WHERE session_id = $1`,
    [sessionId],
  );
  if (!rows[0]) throw new P24TransactionNotFoundError(sessionId);
  return mapRow(rows[0]);
}

/**
 * Vrátí platbu (refund) přes Przelewy24 Refunds API.
 * amountGrosze = null znamená plný refund.
 */
export async function refundPayment(
  sessionId: string,
  amountGrosze: number | null,
  config: P24Config,
  db: DbAdapter,
  http: HttpClient,
): Promise<{ refundId: string; amount: number }> {
  const rows = await db.query<TransactionRow>(
    `SELECT * FROM przelewy24.transactions WHERE session_id = $1`,
    [sessionId],
  );

  if (!rows[0]) throw new P24TransactionNotFoundError(sessionId);
  const tx = rows[0];

  if (tx.status !== 'completed') {
    throw new P24Error(
      `Cannot refund transaction in status: ${tx.status}`,
      'INVALID_STATUS',
    );
  }

  const refundAmount = amountGrosze ?? tx.amount;

  const apiBase = getApiBase(config.sandbox);
  const headers = {
    Authorization: basicAuth(config.posId, config.apiKey),
    'Content-Type': 'application/json',
  };

  interface RefundResponse { data: { refundId: string; amount: number } }
  const resp = await http.post<RefundResponse>(
    `${apiBase}/api/v1/transaction/refund`,
    {
      requestId: `${sessionId}-refund-${Date.now()}`,
      refunds: [
        {
          orderId: Number(tx.p24_order_id),
          sessionId,
          amount: refundAmount,
        },
      ],
    },
    headers,
  );

  await db.execute(
    `UPDATE przelewy24.transactions
     SET status = 'refunded', updated_at = NOW()
     WHERE session_id = $1`,
    [sessionId],
  );

  return resp.data;
}
