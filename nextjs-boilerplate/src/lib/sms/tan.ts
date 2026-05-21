/**
 * TAN (Transaction Authentication Number) — 6-digit SMS code generation + verification.
 *
 * Eventim sends TAN after order purchase (validates phone ownership).
 * Tixly: použít pro 'order_validation' a 'phone_change'.
 *
 * Skeleton — production by se napojila na SMS gateway (Twilio, MessageBird,
 * SMSManager.cz). Bez SMS_PROVIDER env vrátí code v response (dev mode).
 */
import crypto from 'node:crypto';
import { Pool } from 'pg';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

const TAN_TTL_MINUTES = 15;
const MAX_ATTEMPTS = 5;

export type TanPurpose = 'order_validation' | 'phone_change' | 'login';

export interface TanIssueResult {
  tanId: string;
  expiresAt: string;
  /** Pouze v dev mode (bez SMS gateway) — pro test */
  devCode?: string;
}

export async function issueTan(input: {
  userId: string;
  phoneE164: string;
  purpose: TanPurpose;
  relatedId?: string;
}): Promise<TanIssueResult> {
  const code = (crypto.randomInt(0, 1_000_000)).toString().padStart(6, '0');

  // Invalidate existing pending TANs for same purpose
  await db().query(
    `UPDATE identity.tan_codes
        SET consumed_at = now()
      WHERE user_id = $1 AND purpose = $2 AND consumed_at IS NULL`,
    [input.userId, input.purpose],
  );

  const r = await db().query<{ id: string; expires_at: string }>(
    `INSERT INTO identity.tan_codes (user_id, phone_e164, code, purpose, related_id)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, expires_at::text`,
    [input.userId, input.phoneE164, code, input.purpose, input.relatedId ?? null],
  );

  // Send via SMS gateway
  const provider = process.env.SMS_PROVIDER;
  if (provider) {
    void sendSms(input.phoneE164, buildMessage(input.purpose, code)).catch((e) => {
      console.error('[tan] SMS send failed:', e);
    });
    return { tanId: r.rows[0].id, expiresAt: r.rows[0].expires_at };
  }

  // Dev mode: vrátí code v response (NEPRODUKČNÍ)
  console.log(`[tan/DEV] ${input.purpose} code for ${input.phoneE164}: ${code}`);
  return {
    tanId: r.rows[0].id,
    expiresAt: r.rows[0].expires_at,
    devCode: process.env.NODE_ENV !== 'production' ? code : undefined,
  };
}

export interface TanVerifyResult {
  valid: boolean;
  reason?: 'expired' | 'consumed' | 'wrong_code' | 'too_many_attempts' | 'not_found';
  relatedId?: string;
}

export async function verifyTan(input: {
  tanId: string;
  code: string;
}): Promise<TanVerifyResult> {
  const r = await db().query<{
    id: string;
    code: string;
    expires_at: string;
    consumed_at: string | null;
    attempts: number;
    related_id: string | null;
  }>(
    `SELECT id, code, expires_at::text, consumed_at::text, attempts, related_id::text
       FROM identity.tan_codes
      WHERE id = $1
        FOR UPDATE`,
    [input.tanId],
  );

  if (r.rows.length === 0) return { valid: false, reason: 'not_found' };
  const row = r.rows[0];

  if (row.consumed_at) return { valid: false, reason: 'consumed' };
  if (new Date(row.expires_at) < new Date()) return { valid: false, reason: 'expired' };
  if (row.attempts >= MAX_ATTEMPTS) return { valid: false, reason: 'too_many_attempts' };

  if (row.code !== input.code) {
    await db().query(
      `UPDATE identity.tan_codes SET attempts = attempts + 1 WHERE id = $1`,
      [input.tanId],
    );
    return { valid: false, reason: 'wrong_code' };
  }

  await db().query(
    `UPDATE identity.tan_codes SET consumed_at = now() WHERE id = $1`,
    [input.tanId],
  );
  return { valid: true, relatedId: row.related_id ?? undefined };
}

function buildMessage(purpose: TanPurpose, code: string): string {
  switch (purpose) {
    case 'order_validation':
      return `Tixly: Validační kód pro objednávku ${code}. Platí ${TAN_TTL_MINUTES} min.`;
    case 'phone_change':
      return `Tixly: Kód pro změnu telefonu ${code}. Platí ${TAN_TTL_MINUTES} min.`;
    case 'login':
      return `Tixly: Přihlašovací kód ${code}. Platí ${TAN_TTL_MINUTES} min.`;
  }
}

async function sendSms(phoneE164: string, body: string): Promise<void> {
  // Skeleton — production by routovala na SMSManager.cz / Twilio / MessageBird
  const provider = process.env.SMS_PROVIDER;
  if (provider === 'smsmanager') {
    const apiKey = process.env.SMSMANAGER_API_KEY ?? '';
    await fetch('https://http-api.smsmanager.cz/Send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        apikey: apiKey, number: phoneE164, message: body, gateway: 'high',
      }).toString(),
    });
    return;
  }
  // Default no-op
  console.log(`[sms] would send to ${phoneE164}: ${body}`);
}
