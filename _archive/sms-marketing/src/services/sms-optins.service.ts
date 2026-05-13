// =============================================================================
// SMS opt-in flow — Hive-style collection (Feature #180)
//
// Automatický sběr telefonních čísel na potvrzovací stránce objednávky.
// Po dokončení platby fan uvidí: "Chceš dostávat SMS upozornění?"
// Data proudí do SMS marketingového pipeline (bulkgate-sms).
//
// SCHEMA: sms_marketing.* (migration 123)
// =============================================================================

export interface SmsOptIn {
  id: string;
  orderId: string;
  buyerId: string;
  eventId: string;
  phoneNumber: string;  // normalizované +420...
  language: 'cs' | 'en' | 'de';
  opted: boolean;
  optedAt: string | null;
  synced: boolean;      // odesláno do bulkgate-sms?
  syncedAt: string | null;
  createdAt: string;
}

export interface OptInInput {
  orderId: string;
  buyerId: string;
  eventId: string;
  phoneNumber: string;
  language: 'cs' | 'en' | 'de';
}

export interface DbAdapter {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<void>;
  transaction<T>(fn: (tx: DbAdapter) => Promise<T>): Promise<T>;
}

interface OptInRow {
  id: string;
  order_id: string;
  buyer_id: string;
  event_id: string;
  phone_number: string;
  language: string;
  opted: boolean;
  opted_at: string | null;
  synced: boolean;
  synced_at: string | null;
  created_at: string;
}

function normalizePhone(phone: string): string {
  // Normalizuj CZ/SK telefonní čísla na +420/+421
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.startsWith('420') || cleaned.startsWith('421')) {
    return `+${cleaned}`;
  }
  if (cleaned.startsWith('9') || cleaned.startsWith('7')) {
    return `+420${cleaned}`;
  }
  return `+${cleaned}`;
}

function mapOptIn(row: OptInRow): SmsOptIn {
  return {
    id: row.id,
    orderId: row.order_id,
    buyerId: row.buyer_id,
    eventId: row.event_id,
    phoneNumber: row.phone_number,
    language: row.language as 'cs' | 'en' | 'de',
    opted: row.opted,
    optedAt: row.opted_at,
    synced: row.synced,
    syncedAt: row.synced_at,
    createdAt: row.created_at,
  };
}

/**
 * Vytvoří SMS opt-in záznam (po checkout completion event).
 * Upsert: pokud už existuje pro order, aktualizuje.
 */
export async function createOptIn(
  input: OptInInput,
  opted: boolean,
  db: DbAdapter,
): Promise<SmsOptIn> {
  const normalizedPhone = normalizePhone(input.phoneNumber);

  const rows = await db.query<OptInRow>(
    `INSERT INTO sms_marketing.sms_optins
       (order_id, buyer_id, event_id, phone_number, language, opted, opted_at)
     VALUES ($1, $2, $3, $4, $5, $6, CASE WHEN $6 = true THEN NOW() ELSE NULL END)
     ON CONFLICT (order_id) DO UPDATE SET
       phone_number = EXCLUDED.phone_number,
       language = EXCLUDED.language,
       opted = EXCLUDED.opted,
       opted_at = CASE WHEN EXCLUDED.opted = true THEN NOW() ELSE NULL END
     RETURNING *`,
    [
      input.orderId,
      input.buyerId,
      input.eventId,
      normalizedPhone,
      input.language,
      opted,
    ],
  );
  if (!rows[0]) throw new Error('INTERNAL_ERROR: opt-in creation failed');
  return mapOptIn(rows[0]);
}

/**
 * Vrátí opt-ins připravené k synchronizaci (opted=true, synced=false).
 */
export async function getPendingSyncOptIns(db: DbAdapter): Promise<SmsOptIn[]> {
  const rows = await db.query<OptInRow>(
    `SELECT * FROM sms_marketing.sms_optins
     WHERE opted = true AND synced = false
     ORDER BY created_at ASC
     LIMIT 1000`,
    [],
  );
  return rows.map(mapOptIn);
}

/**
 * Markuje opt-in jako synchronizovaný (odeslán do bulkgate-sms).
 */
export async function markSynced(optInId: string, db: DbAdapter): Promise<SmsOptIn> {
  const rows = await db.query<OptInRow>(
    `UPDATE sms_marketing.sms_optins
     SET synced = true, synced_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [optInId],
  );
  if (!rows[0]) throw new Error('NOT_FOUND: Opt-in not found');
  return mapOptIn(rows[0]);
}

/**
 * Vrátí opt-in rate pro event (procento kupujících, kteří se přihlásili).
 */
export async function getOptInStats(
  eventId: string,
  db: DbAdapter,
): Promise<{ total: number; opted: number; optInRate: number }> {
  const rows = await db.query<{ total: number; opted: number }>(
    `SELECT
       COUNT(*) as total,
       SUM(CASE WHEN opted = true THEN 1 ELSE 0 END) as opted
     FROM sms_marketing.sms_optins
     WHERE event_id = $1`,
    [eventId],
  );
  if (!rows[0]) return { total: 0, opted: 0, optInRate: 0 };

  const total = rows[0].total;
  const opted = rows[0].opted || 0;
  return {
    total,
    opted,
    optInRate: total > 0 ? Math.round((opted / total) * 100) : 0,
  };
}
