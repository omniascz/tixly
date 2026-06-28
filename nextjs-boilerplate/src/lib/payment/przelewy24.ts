/**
 * Przelewy24 REST API v1 client.
 *
 * Docs: https://developers.przelewy24.pl/index.php
 * Endpoints: secure.przelewy24.pl (prod) | sandbox.przelewy24.pl (test)
 *
 * Env:
 *   P24_MERCHANT_ID   — Merchant ID (integer)
 *   P24_POS_ID        — POS ID (defaults to MERCHANT_ID)
 *   P24_CRC_KEY       — CRC key (for HMAC signatures)
 *   P24_API_KEY       — REST API key (for Basic auth)
 *   P24_SANDBOX=1     — use sandbox environment
 *
 * Auth: Basic merchantId:apiKey (Base64)
 * Signature: SHA-384 of JSON {sessionId,merchantId,amount,currency,crc}
 */

import { createHash, timingSafeEqual } from 'crypto';

const BASE = process.env.P24_SANDBOX === '1'
  ? 'https://sandbox.przelewy24.pl'
  : 'https://secure.przelewy24.pl';

export interface P24Config {
  merchantId: number;
  posId: number;
  crcKey: string;
  apiKey: string;
  isConfigured: boolean;
}

export function getP24Config(): P24Config {
  const merchantId = Number(process.env.P24_MERCHANT_ID ?? 0);
  const posId = Number(process.env.P24_POS_ID ?? merchantId);
  const crcKey = process.env.P24_CRC_KEY ?? '';
  const apiKey = process.env.P24_API_KEY ?? '';
  return {
    merchantId,
    posId,
    crcKey,
    apiKey,
    isConfigured: !!merchantId && !!crcKey && !!apiKey,
  };
}

function p24Auth(merchantId: number, apiKey: string): string {
  return `Basic ${Buffer.from(`${merchantId}:${apiKey}`).toString('base64')}`;
}

function p24SignRegister(params: {
  sessionId: string;
  merchantId: number;
  amount: number;
  currency: string;
  crcKey: string;
}): string {
  const json = JSON.stringify({
    sessionId: params.sessionId,
    merchantId: params.merchantId,
    amount: params.amount,
    currency: params.currency,
    crc: params.crcKey,
  });
  return createHash('sha384').update(json).digest('hex');
}

function p24SignVerify(params: {
  sessionId: string;
  orderId: number;
  amount: number;
  currency: string;
  crcKey: string;
}): string {
  const json = JSON.stringify({
    sessionId: params.sessionId,
    orderId: params.orderId,
    amount: params.amount,
    currency: params.currency,
    crc: params.crcKey,
  });
  return createHash('sha384').update(json).digest('hex');
}

/** Register transaction and return redirect URL. */
export async function createP24Transaction(input: {
  orderId: string;
  amountGrosze: number;
  currency: string;
  buyerEmail: string;
  buyerName?: string;
  description: string;
  notificationUrl: string;
  returnUrl: string;
}): Promise<{ paymentId: string; gatewayUrl: string }> {
  const cfg = getP24Config();

  const sign = p24SignRegister({
    sessionId: input.orderId,
    merchantId: cfg.merchantId,
    amount: input.amountGrosze,
    currency: input.currency,
    crcKey: cfg.crcKey,
  });

  const body = {
    merchantId: cfg.merchantId,
    posId: cfg.posId,
    sessionId: input.orderId,
    amount: input.amountGrosze,
    currency: input.currency,
    description: input.description,
    email: input.buyerEmail,
    client: input.buyerName ?? '',
    country: 'PL',
    language: 'pl',
    urlReturn: input.returnUrl,
    urlStatus: input.notificationUrl,
    timeLimit: 15,
    encoding: 'UTF-8',
    sign,
  };

  const res = await fetch(`${BASE}/api/v1/transaction/register`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: p24Auth(cfg.merchantId, cfg.apiKey),
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`P24 register HTTP ${res.status}: ${text.slice(0, 300)}`);
  }

  const data = await res.json() as { data: { token: string } };
  const token = data.data.token;

  return {
    paymentId: input.orderId, // sessionId = our orderId (used for webhook lookup)
    gatewayUrl: `${BASE}/trnRequest/${token}`,
  };
}

/** Verify P24 webhook notification signature. */
export function verifyP24NotificationSign(params: {
  sessionId: string;
  orderId: number;
  amount: number;
  currency: string;
  crcKey: string;
  receivedSign: string;
}): boolean {
  const expected = p24SignVerify({
    sessionId: params.sessionId,
    orderId: params.orderId,
    amount: params.amount,
    currency: params.currency,
    crcKey: params.crcKey,
  });
  const a = Buffer.from(params.receivedSign, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Call P24 verify endpoint after receiving notification. */
export async function verifyP24Transaction(params: {
  sessionId: string;
  orderId: number;
  amount: number;
  currency: string;
}): Promise<boolean> {
  const cfg = getP24Config();

  const sign = p24SignVerify({
    sessionId: params.sessionId,
    orderId: params.orderId,
    amount: params.amount,
    currency: params.currency,
    crcKey: cfg.crcKey,
  });

  const body = {
    merchantId: cfg.merchantId,
    posId: cfg.posId,
    sessionId: params.sessionId,
    amount: params.amount,
    currency: params.currency,
    orderId: params.orderId,
    sign,
  };

  const res = await fetch(`${BASE}/api/v1/transaction/verify`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: p24Auth(cfg.merchantId, cfg.apiKey),
    },
    body: JSON.stringify(body),
  });

  return res.ok;
}
