// =============================================================================
// SMS Confirmation Service — 6-digit code delivery with opt-out tracking
// =============================================================================

import { randomInt } from 'crypto';
import { validateAndNormalizePhone } from '../lib/phone-validator.js';
import { SmsError } from '../lib/sms-errors.js';
import type {
  SendConfirmationSmsInput,
  SendBulkConfirmationSmsInput,
  SmsConfirmationResult,
  BulkConfirmationResult,
  OptOutResult,
  OptOutEntry,
} from '../types/sms.js';
import type { ServiceDeps } from './sms.service.js';

// ---------------------------------------------------------------------------
// Row types for DB operations
// ---------------------------------------------------------------------------

interface OptOutRow {
  phone: string;
  user_id: string | null;
  reason: string | null;
  opted_out_at: Date;
}

interface ConfirmationSmsRow {
  id: string;
  recipient_phone: string;
  confirmation_code: string;
  event_name: string;
  event_id: string | null;
  promoter_id: string | null;
  status: string;
  external_id: string | null;
  error_message: string | null;
  sent_at: Date | null;
  created_at: Date;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Generate a random 6-digit code for SMS confirmation
 */
export function generateConfirmationCode(): string {
  const num = randomInt(100000, 999999);
  return String(num);
}

/**
 * Builds SMS text with confirmation code
 */
function buildConfirmationText(code: string, eventName: string): string {
  return `Tvůj potvrzovací kód pro ${eventName}: ${code}. Platnost 10 minut.`;
}

// ---------------------------------------------------------------------------
// Opt-out management
// ---------------------------------------------------------------------------

/**
 * Check if phone number is opted out from SMS
 */
export async function isOptedOut(
  phoneNumber: string,
  deps: ServiceDeps,
): Promise<boolean> {
  const phone = validateAndNormalizePhone(phoneNumber);
  const res = await deps.db.query<{ phone: string }>(
    `SELECT phone FROM sms.opt_outs WHERE phone = $1 LIMIT 1`,
    [phone],
  );
  return res.rowCount > 0;
}

/**
 * User opts out from SMS
 */
export async function addOptOut(
  phoneNumber: string,
  userId?: string,
  reason?: string,
  deps?: ServiceDeps,
): Promise<OptOutResult> {
  if (!deps) {
    throw new SmsError('INVALID_DEPS', 'ServiceDeps not provided');
  }

  const phone = validateAndNormalizePhone(phoneNumber);

  // Check if already opted out
  const existing = await deps.db.query<{ phone: string }>(
    `SELECT phone FROM sms.opt_outs WHERE phone = $1 LIMIT 1`,
    [phone],
  );

  if (existing.rowCount > 0) {
    return {
      success: true,
      optedOut: true,
      phone,
    };
  }

  // Insert opt-out
  await deps.db.query(
    `INSERT INTO sms.opt_outs (phone, user_id, reason, opted_out_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (phone) DO UPDATE SET
       user_id = COALESCE($2, sms.opt_outs.user_id),
       reason = COALESCE($3, sms.opt_outs.reason),
       opted_out_at = NOW()`,
    [phone, userId ?? null, reason ?? null],
  );

  return {
    success: true,
    optedOut: true,
    phone,
  };
}

/**
 * Admin removes opt-out
 */
export async function removeOptOut(
  phoneNumber: string,
  deps: ServiceDeps,
): Promise<OptOutResult> {
  const phone = validateAndNormalizePhone(phoneNumber);

  const res = await deps.db.query<{ phone: string }>(
    `DELETE FROM sms.opt_outs WHERE phone = $1 RETURNING phone`,
    [phone],
  );

  return {
    success: res.rowCount > 0,
    optedOut: false,
    phone,
  };
}

/**
 * Get all opt-outs (for admin purposes)
 */
export async function getOptOuts(
  deps: ServiceDeps,
  limit = 100,
  offset = 0,
): Promise<{ items: OptOutEntry[]; total: number }> {
  const countRes = await deps.db.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM sms.opt_outs`,
  );
  const total = parseInt(countRes.rows[0]?.count ?? '0', 10);

  const res = await deps.db.query<OptOutRow>(
    `SELECT phone, user_id, reason, opted_out_at FROM sms.opt_outs
     ORDER BY opted_out_at DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset],
  );

  return {
    items: res.rows.map((row) => ({
      phone: row.phone,
      userId: row.user_id ?? undefined,
      reason: row.reason ?? undefined,
      optedOutAt: row.opted_out_at,
    })),
    total,
  };
}

// ---------------------------------------------------------------------------
// Send single confirmation SMS
// ---------------------------------------------------------------------------

/**
 * Send 6-digit confirmation code via SMS
 */
export async function sendConfirmationSms(
  input: SendConfirmationSmsInput,
  deps: ServiceDeps,
): Promise<SmsConfirmationResult> {
  // Validate and normalize phone
  const phone = validateAndNormalizePhone(input.phoneNumber);

  // Check if opted out — confirmation SMS is transactional, should bypass opt-out
  // but we track it anyway
  const optedOut = await isOptedOut(phone, deps);

  // Validate code format (6 digits)
  if (!/^\d{6}$/.test(input.code)) {
    throw new SmsError('SMS_INVALID_CODE', 'Kód musí být 6 číslic');
  }

  // Build SMS text
  const text = buildConfirmationText(input.code, input.eventName);

  // Insert pending record
  const insertRes = await deps.db.query<ConfirmationSmsRow>(
    `INSERT INTO sms.confirmation_sms
       (recipient_phone, confirmation_code, event_name, event_id, promoter_id, status)
     VALUES ($1, $2, $3, $4, $5, 'pending')
     RETURNING *`,
    [phone, input.code, input.eventName, input.eventId ?? null, input.promoterId ?? null],
  );

  const row = insertRes.rows[0];
  if (!row) {
    throw new SmsError('SMS_INSERT_FAILED', 'Chyba při uložení SMS');
  }

  const messageId = row.id;

  // Send via BulkGate
  try {
    const result = await deps.bulkgate.sendSingle(phone, text);

    // Update to sent
    await deps.db.query(
      `UPDATE sms.confirmation_sms
       SET status = 'sent',
           external_id = $2,
           sent_at = NOW()
       WHERE id = $1`,
      [messageId, result.smsId],
    );

    // Publish event
    await deps.kafka.publish('sms.confirmation.sent', messageId, {
      messageId,
      phone,
      eventName: input.eventName,
      eventId: input.eventId ?? null,
      promoterId: input.promoterId ?? null,
      externalId: result.smsId,
      optedOut,
    });

    return {
      success: true,
      messageId,
      sentAt: new Date(),
      phone,
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);

    // Mark as failed
    await deps.db.query(
      `UPDATE sms.confirmation_sms
       SET status = 'failed',
           error_message = $2
       WHERE id = $1`,
      [messageId, errorMessage],
    );

    // Publish failure event
    await deps.kafka.publish('sms.confirmation.failed', messageId, {
      messageId,
      phone,
      eventName: input.eventName,
      eventId: input.eventId ?? null,
      promoterId: input.promoterId ?? null,
      errorMessage,
    });

    throw err;
  }
}

// ---------------------------------------------------------------------------
// Send bulk confirmation SMS
// ---------------------------------------------------------------------------

/**
 * Batch send confirmation codes with partial failure handling
 */
export async function sendBulkConfirmationSms(
  input: SendBulkConfirmationSmsInput,
  deps: ServiceDeps,
): Promise<BulkConfirmationResult> {
  // Validate code format
  if (!/^\d{6}$/.test(input.code)) {
    throw new SmsError('SMS_INVALID_CODE', 'Kód musí být 6 číslic');
  }

  // Build SMS text
  const text = buildConfirmationText(input.code, input.eventName);

  const results: BulkConfirmationResult['results'] = [];
  let sentCount = 0;
  let failedCount = 0;

  // Validate phones in parallel, but process sequentially for rate limiting
  const validPhones: string[] = [];
  const rejected: Array<{ phone: string; reason: string }> = [];

  for (const rawPhone of input.phoneNumbers) {
    try {
      const phone = validateAndNormalizePhone(rawPhone);
      validPhones.push(phone);
    } catch {
      rejected.push({ phone: rawPhone, reason: 'invalid_phone' });
      results.push({
        phone: rawPhone,
        success: false,
        error: 'invalid_phone',
      });
      failedCount++;
    }
  }

  // Get opt-outs for all phones
  let optedOutSet = new Set<string>();
  if (validPhones.length > 0) {
    const optOutRes = await deps.db.query<{ phone: string }>(
      `SELECT phone FROM sms.opt_outs WHERE phone = ANY($1::text[])`,
      [validPhones],
    );
    optedOutSet = new Set(optOutRes.rows.map((r) => r.phone));
  }

  // Process each phone
  for (const phone of validPhones) {
    try {
      // Insert confirmation record
      const insertRes = await deps.db.query<{ id: string }>(
        `INSERT INTO sms.confirmation_sms
           (recipient_phone, confirmation_code, event_name, event_id, promoter_id, status)
         VALUES ($1, $2, $3, $4, $5, 'pending')
         RETURNING id`,
        [phone, input.code, input.eventName, input.eventId ?? null, input.promoterId ?? null],
      );

      const messageId = insertRes.rows[0]?.id;
      if (!messageId) {
        throw new Error('Failed to insert confirmation SMS record');
      }

      // Send via BulkGate
      const bgResult = await deps.bulkgate.sendSingle(phone, text);

      // Update to sent
      await deps.db.query(
        `UPDATE sms.confirmation_sms
         SET status = 'sent',
             external_id = $2,
             sent_at = NOW()
         WHERE id = $1`,
        [messageId, bgResult.smsId],
      );

      // Publish event
      await deps.kafka.publish('sms.confirmation.sent', messageId, {
        messageId,
        phone,
        eventName: input.eventName,
        eventId: input.eventId ?? null,
        promoterId: input.promoterId ?? null,
        externalId: bgResult.smsId,
        optedOut: optedOutSet.has(phone),
      });

      results.push({
        phone,
        success: true,
        messageId,
      });
      sentCount++;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);

      results.push({
        phone,
        success: false,
        error: errorMessage,
      });
      failedCount++;
    }
  }

  // Add rejected phones to results
  for (const rej of rejected) {
    results.push({
      phone: rej.phone,
      success: false,
      error: rej.reason,
    });
  }

  // Publish bulk completion event
  await deps.kafka.publish('sms.confirmation.bulk_completed', input.eventId ?? 'unknown', {
    eventId: input.eventId ?? null,
    eventName: input.eventName,
    promoterId: input.promoterId ?? null,
    total: input.phoneNumbers.length,
    sent: sentCount,
    failed: failedCount,
  });

  return {
    sent: sentCount,
    failed: failedCount,
    results,
  };
}

// ---------------------------------------------------------------------------
// Phone normalization
// ---------------------------------------------------------------------------

/**
 * Normalize phone number to international E.164 format
 */
export function normalizePhone(phone: string): string {
  return validateAndNormalizePhone(phone);
}
