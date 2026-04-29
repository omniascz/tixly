// =============================================================================
// SMS service — orchestrace DB + BulkGate + Kafka
// =============================================================================

import { SmsError } from '../lib/sms-errors.js';
import {
  validateAndNormalizePhone,
} from '../lib/phone-validator.js';
import { isWithinSmsLimit } from '../lib/sms-segmenter.js';
import type { BulkgateClient } from '../lib/bulkgate-client.js';
import type {
  SmsMessage,
  SmsCategory,
  SmsStatus,
  SendSingleSmsInput,
  SendBulkSmsInput,
  BulkSmsResult,
} from '../types/sms.js';

// ---------------------------------------------------------------------------
// Dependency injection
// ---------------------------------------------------------------------------

export interface DbQueryResult<T = Record<string, unknown>> {
  rows: T[];
  rowCount: number;
}

export interface SmsDbAdapter {
  query<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<DbQueryResult<T>>;
}

export interface KafkaProducer {
  publish(topic: string, key: string, payload: Record<string, unknown>): Promise<void>;
}

export interface ServiceDeps {
  db: SmsDbAdapter;
  kafka: KafkaProducer;
  bulkgate: BulkgateClient;
}

// ---------------------------------------------------------------------------
// Row mapping
// ---------------------------------------------------------------------------

interface SmsMessageRow {
  id: string;
  promoter_id: string | null;
  recipient_phone: string;
  text: string;
  category: string;
  status: string;
  external_id: string | null;
  error_message: string | null;
  cost_halire: number | null;
  sent_at: Date | null;
  delivered_at: Date | null;
  created_at: Date;
}

function mapRow(row: SmsMessageRow): SmsMessage {
  return {
    id: row.id,
    promoterId: row.promoter_id,
    recipientPhone: row.recipient_phone,
    text: row.text,
    category: row.category as SmsCategory,
    status: row.status as SmsStatus,
    externalId: row.external_id,
    errorMessage: row.error_message,
    costHalire: row.cost_halire,
    sentAt: row.sent_at,
    deliveredAt: row.delivered_at,
    createdAt: row.created_at,
  };
}

// ---------------------------------------------------------------------------
// Opt-out management
// ---------------------------------------------------------------------------

export async function optOutRecipient(
  phone: string,
  deps: ServiceDeps,
): Promise<void> {
  const normalized = validateAndNormalizePhone(phone);
  await deps.db.query(
    `INSERT INTO sms.opt_outs (phone, opted_out_at, reason)
     VALUES ($1, NOW(), 'user_request')
     ON CONFLICT (phone) DO NOTHING`,
    [normalized],
  );
}

export async function isOptedOut(
  phone: string,
  deps: ServiceDeps,
): Promise<boolean> {
  const normalized = validateAndNormalizePhone(phone);
  const res = await deps.db.query<{ phone: string }>(
    `SELECT phone FROM sms.opt_outs WHERE phone = $1 LIMIT 1`,
    [normalized],
  );
  return res.rowCount > 0;
}

// ---------------------------------------------------------------------------
// Send single
// ---------------------------------------------------------------------------

export async function sendSingleSms(
  input: SendSingleSmsInput,
  deps: ServiceDeps,
): Promise<SmsMessage> {
  const phone = validateAndNormalizePhone(input.phone);

  if (!isWithinSmsLimit(input.text, 10)) {
    throw new SmsError('SMS_TEXT_TOO_LONG');
  }

  // Marketing → respektuj opt-out. Transactional (např. delivery vstupenky) bypassuje.
  if (input.category === 'marketing') {
    if (await isOptedOut(phone, deps)) {
      throw new SmsError('SMS_RECIPIENT_OPTED_OUT');
    }
  }

  // 1) INSERT pending
  const insertRes = await deps.db.query<SmsMessageRow>(
    `INSERT INTO sms.messages
       (promoter_id, recipient_phone, text, category, status)
     VALUES ($1, $2, $3, $4, 'pending')
     RETURNING *`,
    [input.promoterId ?? null, phone, input.text, input.category],
  );

  const row = insertRes.rows[0]!;
  const messageId = row.id;

  // 2) Call provider
  try {
    const result = await deps.bulkgate.sendSingle(phone, input.text);

    const updateRes = await deps.db.query<SmsMessageRow>(
      `UPDATE sms.messages
         SET status = 'sent',
             external_id = $2,
             cost_halire = $3,
             sent_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [messageId, result.smsId, result.priceHalire],
    );

    const updated = updateRes.rows[0]!;

    await deps.kafka.publish('sms.sent', messageId, {
      messageId,
      promoterId: input.promoterId ?? null,
      phone,
      category: input.category,
      externalId: result.smsId,
      costHalire: result.priceHalire,
    });

    return mapRow(updated);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);

    const failRes = await deps.db.query<SmsMessageRow>(
      `UPDATE sms.messages
         SET status = 'failed',
             error_message = $2
       WHERE id = $1
       RETURNING *`,
      [messageId, errorMessage],
    );

    await deps.kafka.publish('sms.failed', messageId, {
      messageId,
      promoterId: input.promoterId ?? null,
      phone,
      category: input.category,
      errorMessage,
    });

    const failed = failRes.rows[0];
    if (failed) {
      return mapRow(failed);
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Send bulk
// ---------------------------------------------------------------------------

export async function sendBulkSms(
  input: SendBulkSmsInput,
  deps: ServiceDeps,
): Promise<BulkSmsResult> {
  if (!isWithinSmsLimit(input.text, 10)) {
    throw new SmsError('SMS_TEXT_TOO_LONG');
  }

  const rejected: Array<{ phone: string; reason: string }> = [];
  const validated: string[] = [];

  // 1) Validace telefonů
  for (const raw of input.phones) {
    try {
      validated.push(validateAndNormalizePhone(raw));
    } catch {
      rejected.push({ phone: raw, reason: 'invalid_phone' });
    }
  }

  // 2) Filtr opt-outs jedním dotazem
  let eligible: string[] = validated;
  if (validated.length > 0) {
    const optOutRes = await deps.db.query<{ phone: string }>(
      `SELECT phone FROM sms.opt_outs WHERE phone = ANY($1::text[])`,
      [validated],
    );
    const optedOutSet = new Set(optOutRes.rows.map((r) => r.phone));

    eligible = [];
    for (const phone of validated) {
      if (optedOutSet.has(phone)) {
        rejected.push({ phone, reason: 'opted_out' });
      } else {
        eligible.push(phone);
      }
    }
  }

  const total = input.phones.length;

  if (eligible.length === 0) {
    await deps.kafka.publish('sms.bulk_completed', input.promoterId, {
      promoterId: input.promoterId,
      segmentName: input.segmentName ?? null,
      total,
      queued: 0,
      rejected: rejected.length,
    });
    return { total, queued: 0, rejected };
  }

  // 3) INSERT queued rows + zapamatuj si id
  const ids = new Map<string, string>();
  for (const phone of eligible) {
    const res = await deps.db.query<{ id: string }>(
      `INSERT INTO sms.messages
         (promoter_id, recipient_phone, text, category, status, segment_name)
       VALUES ($1, $2, $3, 'marketing', 'queued', $4)
       RETURNING id`,
      [input.promoterId, phone, input.text, input.segmentName ?? null],
    );
    ids.set(phone, res.rows[0]!.id);
  }

  // 4) Pošli přes BulkGate
  let queued = 0;
  try {
    const result = await deps.bulkgate.sendBulk(eligible, input.text);

    for (const phone of result.accepted) {
      const id = ids.get(phone);
      if (!id) continue;
      await deps.db.query(
        `UPDATE sms.messages SET status = 'sent', sent_at = NOW() WHERE id = $1`,
        [id],
      );
      queued++;
    }

    for (const rej of result.rejected) {
      const id = ids.get(rej.phone);
      if (id) {
        await deps.db.query(
          `UPDATE sms.messages
             SET status = 'failed', error_message = $2
           WHERE id = $1`,
          [id, rej.reason],
        );
      }
      rejected.push(rej);
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    for (const id of ids.values()) {
      await deps.db.query(
        `UPDATE sms.messages
           SET status = 'failed', error_message = $2
         WHERE id = $1`,
        [id, errorMessage],
      );
    }
    for (const phone of eligible) {
      rejected.push({ phone, reason: errorMessage });
    }
  }

  await deps.kafka.publish('sms.bulk_completed', input.promoterId, {
    promoterId: input.promoterId,
    segmentName: input.segmentName ?? null,
    total,
    queued,
    rejected: rejected.length,
  });

  return { total, queued, rejected };
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

export async function getSmsHistory(
  promoterId: string,
  filters: {
    category?: SmsCategory;
    status?: SmsStatus;
    from?: Date;
    to?: Date;
  },
  pagination: { limit?: number; offset?: number },
  deps: ServiceDeps,
): Promise<{ items: SmsMessage[]; total: number }> {
  const where: string[] = ['promoter_id = $1'];
  const params: unknown[] = [promoterId];
  let idx = 2;

  if (filters.category) {
    where.push(`category = $${idx++}`);
    params.push(filters.category);
  }
  if (filters.status) {
    where.push(`status = $${idx++}`);
    params.push(filters.status);
  }
  if (filters.from) {
    where.push(`created_at >= $${idx++}`);
    params.push(filters.from);
  }
  if (filters.to) {
    where.push(`created_at <= $${idx++}`);
    params.push(filters.to);
  }

  const whereSql = where.join(' AND ');

  const countRes = await deps.db.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM sms.messages WHERE ${whereSql}`,
    params,
  );
  const total = parseInt(countRes.rows[0]?.count ?? '0', 10);

  const limit = Math.min(pagination.limit ?? 50, 500);
  const offset = pagination.offset ?? 0;
  const listParams = [...params, limit, offset];

  const listRes = await deps.db.query<SmsMessageRow>(
    `SELECT * FROM sms.messages
      WHERE ${whereSql}
      ORDER BY created_at DESC
      LIMIT $${idx++} OFFSET $${idx}`,
    listParams,
  );

  return {
    items: listRes.rows.map(mapRow),
    total,
  };
}
