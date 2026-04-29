/**
 * BulkGate SMS — mock provider pro lokální demo.
 *
 * V produkci přepojit na skutečný BulkGate API (https://www.bulkgate.com/api).
 * Zde jen logujeme do `audit.audit_log` (table='sms_log') aby se daly zpětně
 * dohledat odeslané zprávy.
 */

import type { Pool, PoolClient } from 'pg';

export type SmsProvider = 'bulkgate' | 'mock';

export interface SmsSendResult {
  ok: boolean;
  messageId: string;
  provider: SmsProvider;
  /** Náklady v haléřích (pro reporting). */
  costHalire: number;
  reason?: string;
}

export interface SmsSendInput {
  to: string;
  text: string;
  /** Maximálně 160 znaků pro standardní SMS, jinak split na multi-part. */
  unicode?: boolean;
  /** Pokud poskytneš, log obsahuje promoter_id pro per-tenant tracking. */
  promoterId?: string;
  /** Pokud poskytneš, log obsahuje order_id reference. */
  orderId?: string;
}

const STANDARD_SMS_COST_HALIRE = 100; // 1 Kč mock cost

function normalizePhone(phone: string): string {
  const trimmed = phone.replace(/\s+/g, '');
  // Czech default: +420
  if (/^\d{9}$/.test(trimmed)) return '+420' + trimmed;
  if (/^00\d+$/.test(trimmed)) return '+' + trimmed.slice(2);
  return trimmed;
}

export async function sendSms(
  input: SmsSendInput,
  db: Pool | PoolClient,
): Promise<SmsSendResult> {
  const isMock = process.env.BULKGATE_MOCK === '1' || !process.env.BULKGATE_TOKEN;
  const provider: SmsProvider = isMock ? 'mock' : 'bulkgate';

  if (input.text.length > 480) {
    return {
      ok: false,
      messageId: '',
      provider,
      costHalire: 0,
      reason: `SMS příliš dlouhá (${input.text.length} znaků, max 480)`,
    };
  }

  const phone = normalizePhone(input.to);
  if (!/^\+\d{8,15}$/.test(phone)) {
    return {
      ok: false,
      messageId: '',
      provider,
      costHalire: 0,
      reason: `Neplatné telefonní číslo: ${input.to}`,
    };
  }

  // Mock — log a vrať fake ID. V produkci by zde bylo POST na BulkGate API.
  const messageId = `${provider}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const segments = Math.ceil(input.text.length / 160);
  const cost = STANDARD_SMS_COST_HALIRE * segments;

  // Audit log entry — schema=sms, table=sms_log, action=INSERT
  try {
    await db.query(
      `INSERT INTO audit.audit_log
         (schema_name, table_name, record_id, action, actor_type,
          new_values)
       VALUES ('sms', 'sms_log', $1, 'INSERT', 'system', $2::jsonb)`,
      [
        messageId,
        JSON.stringify({
          provider,
          to: phone,
          text: input.text.slice(0, 200),
          segments,
          cost_halire: cost,
          promoter_id: input.promoterId ?? null,
          order_id: input.orderId ?? null,
        }),
      ],
    );
  } catch (err) {
    console.error('[sms] audit log failed:', err);
  }

  return { ok: true, messageId, provider, costHalire: cost };
}
