/**
 * BulkGate SMS provider (https://www.bulkgate.com/api).
 *
 * Dev / fallback mode: pokud chybí `BULKGATE_APPLICATION_ID` + `BULKGATE_APPLICATION_TOKEN`,
 * funguje jen jako mock — zaloguje do `audit.audit_log` a vrátí fake messageId.
 *
 * Produkční env vars:
 *   BULKGATE_APPLICATION_ID      (z BulkGate portálu)
 *   BULKGATE_APPLICATION_TOKEN   (z BulkGate portálu)
 *   BULKGATE_SENDER_ID           (volitelné, default 'Tixly' — schválené BulkGate)
 *   BULKGATE_MOCK=1              (přinucené mock i s tokeny — pro testy)
 *
 * BulkGate cost: ~0.7–1.5 Kč per segment dle země. Tracked přes audit.audit_log.
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

const STANDARD_SMS_COST_HALIRE = 100; // 1 Kč fallback estimate (BulkGate vrátí real cost v response)
const BULKGATE_API_URL = 'https://portal.bulkgate.com/api/1.0/simple/transactional';

function normalizePhone(phone: string): string {
  const trimmed = phone.replace(/\s+/g, '');
  // Czech default: +420
  if (/^\d{9}$/.test(trimmed)) return '+420' + trimmed;
  if (/^00\d+$/.test(trimmed)) return '+' + trimmed.slice(2);
  return trimmed;
}

interface BulkGateResponse {
  data?: {
    response?: Array<{
      status?: string;
      sms_id?: string;
      price?: { credit?: number; total?: number };
      error?: string;
    }>;
  };
  error?: string;
}

async function callBulkGateApi(input: {
  applicationId: string;
  applicationToken: string;
  senderId: string;
  phone: string;
  text: string;
  unicode: boolean;
}): Promise<{ ok: boolean; messageId: string; costHalire: number; reason?: string }> {
  try {
    const res = await fetch(BULKGATE_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        application_id: input.applicationId,
        application_token: input.applicationToken,
        number: input.phone,
        text: input.text,
        sender_id: 'gText',
        sender_id_value: input.senderId,
        unicode: input.unicode,
        country: 'cz',
      }),
    });
    if (!res.ok) {
      return { ok: false, messageId: '', costHalire: 0, reason: `BulkGate HTTP ${res.status}` };
    }
    const j = (await res.json()) as BulkGateResponse;
    const first = j.data?.response?.[0];
    if (j.error || !first || first.status !== 'accepted') {
      return {
        ok: false,
        messageId: first?.sms_id ?? '',
        costHalire: 0,
        reason: j.error ?? first?.error ?? `BulkGate status=${first?.status ?? 'unknown'}`,
      };
    }
    // BulkGate cost je v credits (1 credit ≈ jedna SMS). Pro reporting v halířích
    // multiplikujeme stand. cenou 100 hal (1 Kč). Real billing přes BulkGate dashboard.
    const credits = first.price?.credit ?? 1;
    return {
      ok: true,
      messageId: first.sms_id ?? '',
      costHalire: Math.round(credits * STANDARD_SMS_COST_HALIRE),
    };
  } catch (err) {
    return {
      ok: false,
      messageId: '',
      costHalire: 0,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function sendSms(
  input: SmsSendInput,
  db: Pool | PoolClient,
): Promise<SmsSendResult> {
  const applicationId = process.env.BULKGATE_APPLICATION_ID;
  const applicationToken = process.env.BULKGATE_APPLICATION_TOKEN;
  const senderId = process.env.BULKGATE_SENDER_ID ?? 'Tixly';
  const isMock =
    process.env.BULKGATE_MOCK === '1' || !applicationId || !applicationToken;
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

  const segments = Math.ceil(input.text.length / 160);
  let messageId: string;
  let cost: number;
  let sendOk = true;
  let reason: string | undefined;

  if (isMock) {
    messageId = `${provider}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    cost = STANDARD_SMS_COST_HALIRE * segments;
  } else {
    const r = await callBulkGateApi({
      applicationId: applicationId!,
      applicationToken: applicationToken!,
      senderId,
      phone,
      text: input.text,
      unicode: input.unicode ?? false,
    });
    sendOk = r.ok;
    messageId = r.messageId || `bulkgate-failed-${Date.now()}`;
    cost = r.costHalire;
    reason = r.reason;
  }

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
          ok: sendOk,
          reason: reason ?? null,
          promoter_id: input.promoterId ?? null,
          order_id: input.orderId ?? null,
        }),
      ],
    );
  } catch (err) {
    console.error('[sms] audit log failed:', err);
  }

  return sendOk
    ? { ok: true, messageId, provider, costHalire: cost }
    : { ok: false, messageId, provider, costHalire: cost, reason };
}
