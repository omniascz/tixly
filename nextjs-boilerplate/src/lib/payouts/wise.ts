/**
 * Wise (TransferWise) Payout API.
 *
 * Covers:
 *   - SEPA Credit Transfer (EU promoters — DE, AT, NL, BE, FR, IT, ES, PL...)
 *   - SWIFT/international wire
 *   - Multi-currency payouts (EUR, GBP, PLN, etc.)
 *   - Domestic CZ transfers (if Wise preferred over FIO)
 *
 * Flow:
 *   1. Create/retrieve recipient account → wise_recipient_id cached on promoter
 *   2. Create quote (source=Tixly's Wise currency, target=payout currency+amount)
 *   3. Create transfer (quoteId + recipientId)
 *   4. Fund transfer from Wise balance
 *
 * Env vars:
 *   WISE_API_KEY        — API key (read+write scope for payouts)
 *   WISE_PROFILE_ID     — numeric business profile ID
 *   WISE_SANDBOX        — "1" for sandbox (api.sandbox.transferwise.com)
 *
 * Reference: https://docs.wise.com/api-docs/guides/send-money
 */

import { constants as cryptoConstants, createPublicKey, verify as cryptoVerify } from 'crypto';

// WISE_API_BASE_URL přepíše cíl (testy proti simulátoru); čte se při každém volání.
const baseUrl = (): string => process.env.WISE_API_BASE_URL
  ?? (process.env.WISE_SANDBOX === '1' ? 'https://api.sandbox.transferwise.com' : 'https://api.wise.com');

export interface WiseConfig {
  apiKey: string;
  profileId: string;
  isConfigured: boolean;
}

export function getWiseConfig(): WiseConfig {
  const apiKey = process.env.WISE_API_KEY ?? '';
  const profileId = process.env.WISE_PROFILE_ID ?? '';
  return { apiKey, profileId, isConfigured: Boolean(apiKey && profileId) };
}

async function wiseRequest<T>(
  method: 'GET' | 'POST' | 'PUT',
  path: string,
  body?: unknown,
): Promise<T> {
  const cfg = getWiseConfig();
  const res = await fetch(`${baseUrl()}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${cfg.apiKey}`,
      'Content-Type': 'application/json',
      'X-idempotence-uuid': undefined as unknown as string, // removed — caller sets per-op
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Wise API ${res.status} on ${method} ${path}: ${text}`);
  }
  return res.json() as Promise<T>;
}

async function wisePost<T>(path: string, body: unknown, idempotencyKey?: string): Promise<T> {
  const cfg = getWiseConfig();
  const res = await fetch(`${baseUrl()}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cfg.apiKey}`,
      'Content-Type': 'application/json',
      ...(idempotencyKey ? { 'X-idempotence-uuid': idempotencyKey } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Wise API ${res.status} POST ${path}: ${text}`);
  }
  return res.json() as Promise<T>;
}

// ─── Recipient accounts ────────────────────────────────────────────────

export interface WiseRecipient {
  id: number;
  currency: string;
  name: string;
  iban?: string;
}

/**
 * Create a Wise recipient account (for IBAN-based SEPA/SWIFT transfers).
 * Cached result should be stored in promoters.wise_recipient_id.
 */
export async function createWiseRecipient(input: {
  accountHolderName: string;
  currency: string;
  iban: string;
  bic?: string;
  legalType?: 'BUSINESS' | 'PRIVATE';
}): Promise<WiseRecipient> {
  const cfg = getWiseConfig();
  return wiseRequest<WiseRecipient>('POST', '/v1/accounts', {
    currency: input.currency,
    type: 'iban',
    profile: Number(cfg.profileId),
    accountHolderName: input.accountHolderName,
    legalType: input.legalType ?? 'BUSINESS',
    details: {
      iban: input.iban.replace(/\s/g, ''),
      ...(input.bic ? { bic: input.bic } : {}),
    },
  });
}

/**
 * Get an existing Wise recipient account by ID.
 */
export async function getWiseRecipient(recipientId: number): Promise<WiseRecipient> {
  return wiseRequest<WiseRecipient>('GET', `/v1/accounts/${recipientId}`);
}

// ─── Quotes ───────────────────────────────────────────────────────────

interface WiseQuote {
  id: string;
  sourceCurrency: string;
  targetCurrency: string;
  targetAmount: number;
  sourceAmount: number;
  rate: number;
}

async function createQuote(input: {
  sourceCurrency: string;
  targetCurrency: string;
  targetAmount: number;
  paymentMetadata?: unknown;
}): Promise<WiseQuote> {
  const cfg = getWiseConfig();
  return wisePost<WiseQuote>(`/v3/profiles/${cfg.profileId}/quotes`, {
    sourceCurrency: input.sourceCurrency,
    targetCurrency: input.targetCurrency,
    targetAmount: input.targetAmount,
    paymentMetadata: input.paymentMetadata,
  });
}

// ─── Transfers ────────────────────────────────────────────────────────

export interface WiseTransfer {
  id: number;
  targetAccount: number;
  quote: string;
  status: string;
  reference: string;
  customerTransactionId: string;
}

interface WiseFundResult {
  type: string;
  status: string;
  errorCode?: string;
}

/**
 * Create and fund a Wise transfer.
 *
 * @param idempotencyKey  Our payout UUID — prevents duplicate transfers on retry
 * @returns transfer object (check transfer.status: 'incoming_payment_waiting' → processing)
 */
export async function createAndFundWiseTransfer(input: {
  recipientId: number;
  sourceCurrency: string;
  targetCurrency: string;
  targetAmountMajorUnits: number;
  reference: string;
  idempotencyKey: string;
}): Promise<{ transfer: WiseTransfer; fundStatus: string }> {
  // 1. Quote
  const quote = await createQuote({
    sourceCurrency: input.sourceCurrency,
    targetCurrency: input.targetCurrency,
    targetAmount: input.targetAmountMajorUnits,
  });

  // 2. Transfer (idempotent via customerTransactionId)
  const cfg = getWiseConfig();
  const transfer = await wisePost<WiseTransfer>(
    '/v1/transfers',
    {
      targetAccount: input.recipientId,
      quoteUuid: quote.id,
      customerTransactionId: input.idempotencyKey,
      details: {
        reference: input.reference,
      },
    },
    input.idempotencyKey,
  );

  // 3. Fund from Wise balance
  const fundResult = await wisePost<WiseFundResult>(
    `/v3/profiles/${cfg.profileId}/transfers/${transfer.id}/payments`,
    { type: 'BALANCE' },
  );

  return { transfer, fundStatus: fundResult.status };
}

/**
 * Get transfer status for webhook reconciliation.
 */
/**
 * Kolo 2: ověření podpisu Wise notifikace.
 * Wise podepisuje tělo RSA klíčem (SHA256), podpis je Base64 v hlavičce X-Signature-SHA256;
 * ověřuje se VEŘEJNÝM klíčem Wise (zvlášť produkční a sandbox) — viz oficiální příklad
 * github.com/transferwise/digital-signatures-examples/verify-webhook-signature.
 * Dřívější HMAC se sdíleným tajemstvím skutečné notifikace Wise nikdy neověřil.
 * Bez WISE_WEBHOOK_PUBLIC_KEY (PEM) → false (fail-closed).
 */
export function verifyWiseWebhookSignature(rawBody: string, signatureB64: string | null): boolean {
  const pem = process.env.WISE_WEBHOOK_PUBLIC_KEY ?? '';
  if (!pem || !signatureB64) return false;
  try {
    // env často nese PEM na jednom řádku s doslovným "\n"
    const key = createPublicKey({ key: pem.replace(/\\n/g, '\n'), format: 'pem' });
    return cryptoVerify('RSA-SHA256', Buffer.from(rawBody), { key, padding: cryptoConstants.RSA_PKCS1_PADDING },
      Buffer.from(signatureB64, 'base64'));
  } catch {
    return false;
  }
}

export async function getWiseTransferStatus(transferId: number): Promise<string> {
  const t = await wiseRequest<WiseTransfer>('GET', `/v1/transfers/${transferId}`);
  return t.status;
}

// ─── Exchange rates ───────────────────────────────────────────────────

interface WiseRate {
  source: string;
  target: string;
  rate: number;
  time: string;
}

export async function getWiseRate(source: string, target: string): Promise<number> {
  const rates = await wiseRequest<WiseRate[]>('GET', `/v1/rates?source=${source}&target=${target}`);
  return rates[0]?.rate ?? 1;
}
