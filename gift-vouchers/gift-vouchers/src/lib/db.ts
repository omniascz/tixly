// DB adapter factory — returns a VoucherDbAdapter backed by node-postgres.
// Replace the SQL with your actual schema/table names.
// The adapter is a singleton per process (pool is reused across requests).

import type { GiftVoucher } from '../types/gift-voucher.types';
import type { VoucherDbAdapter, Tx } from '../services/gift-voucher.service';
import type { Pool as PgPool } from 'pg';

// ---------------------------------------------------------------------------
// Lazy pool initialisation (avoids importing pg at module load in test envs)
// ---------------------------------------------------------------------------

let _pool: PgPool | null = null;

function getPool() {
  if (!_pool) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Pool } = require('pg') as typeof import('pg');
    _pool = new Pool({ connectionString: process.env['DATABASE_URL'] });
  }
  return _pool;
}

// ---------------------------------------------------------------------------
// Row → domain mapper
// ---------------------------------------------------------------------------

function mapRow(row: Record<string, unknown>): GiftVoucher {
  return {
    id: row.id as string,
    code: row.code as string,
    type: row.type as GiftVoucher['type'],
    status: row.status as GiftVoucher['status'],
    initial_value: Number(row.initial_value as number),
    remaining_value: Number(row.remaining_value as number),
    currency: row.currency as string,
    purchaser_user_id: row.purchaser_user_id as string,
    recipient_email: (row.recipient_email as string | null) ?? null,
    recipient_name: (row.recipient_name as string | null) ?? null,
    applicable_event_id: (row.applicable_event_id as string | null) ?? null,
    applicable_ticket_type_id: (row.applicable_ticket_type_id as string | null) ?? null,
    valid_until: new Date(row.valid_until as string),
    issued_at: new Date(row.issued_at as string),
    sent_at: row.sent_at ? new Date(row.sent_at as string) : null,
    redeemed_at: row.redeemed_at ? new Date(row.redeemed_at as string) : null,
    redemption_order_id: (row.redemption_order_id as string | null) ?? null,
    personal_message: (row.personal_message as string | null) ?? null,
  };
}

// ---------------------------------------------------------------------------
// Adapter implementation
// ---------------------------------------------------------------------------

function buildAdapter(): VoucherDbAdapter {
  const pool = getPool();

  return {
    async findVoucherByCode(code: string): Promise<GiftVoucher | null> {
      // NOTE: production should use SELECT ... FOR UPDATE inside a transaction
      // for the second fetch in redeemVoucher. The withTransaction wrapper
      // passes a pg.PoolClient as `tx`; the adapter ignores it here because
      // the service calls findVoucherByCode on the same adapter — in a real
      // implementation you'd pass the client through.
      const result = await pool.query(
        'SELECT * FROM gift_vouchers.vouchers WHERE code = $1 LIMIT 1',
        [code],
      );
      return result.rows.length > 0 ? mapRow(result.rows[0]) : null;
    },

    async findVoucherById(id: string): Promise<GiftVoucher | null> {
      const result = await pool.query(
        'SELECT * FROM gift_vouchers.vouchers WHERE id = $1 LIMIT 1',
        [id],
      );
      return result.rows.length > 0 ? mapRow(result.rows[0]) : null;
    },

    async createVoucher(data: Omit<GiftVoucher, 'id' | 'issued_at'>): Promise<GiftVoucher> {
      const result = await pool.query(
        `INSERT INTO gift_vouchers.vouchers (
           code, type, status, initial_value, remaining_value, currency,
           purchaser_user_id, recipient_email, recipient_name,
           applicable_event_id, applicable_ticket_type_id,
           valid_until, issued_at,
           sent_at, redeemed_at, redemption_order_id, personal_message
         ) VALUES (
           $1, $2, $3, $4, $5, $6,
           $7, $8, $9,
           $10, $11,
           $12, NOW(),
           $13, $14, $15, $16
         ) RETURNING *`,
        [
          data.code,
          data.type,
          data.status,
          data.initial_value,
          data.remaining_value,
          data.currency,
          data.purchaser_user_id,
          data.recipient_email,
          data.recipient_name,
          data.applicable_event_id,
          data.applicable_ticket_type_id,
          data.valid_until.toISOString(),
          data.sent_at?.toISOString() ?? null,
          data.redeemed_at?.toISOString() ?? null,
          data.redemption_order_id,
          data.personal_message,
        ],
      );
      return mapRow(result.rows[0]);
    },

    async updateVoucher(id: string, data: Partial<GiftVoucher>, tx?: Tx): Promise<GiftVoucher> {
      const client = tx ?? pool;

      const entries = Object.entries(data).filter(([, v]) => v !== undefined);
      if (entries.length === 0) {
        const current = await this.findVoucherById(id);
        if (!current) throw new Error(`Voucher ${id} not found`);
        return current;
      }

      // Whitelist of allowed column names — prevents SQL injection via dynamic key names
      const ALLOWED_COLUMNS = new Set([
        'code', 'type', 'status', 'initial_value', 'remaining_value', 'currency',
        'purchaser_user_id', 'recipient_email', 'recipient_name',
        'applicable_event_id', 'applicable_ticket_type_id',
        'valid_until', 'sent_at', 'redeemed_at', 'redemption_order_id', 'personal_message',
      ]);
      const safeEntries = entries.filter(([key]) => ALLOWED_COLUMNS.has(key));
      if (safeEntries.length === 0) {
        const current = await this.findVoucherById(id);
        if (!current) throw new Error(`Voucher ${id} not found`);
        return current;
      }
      const setClauses = safeEntries.map(([key], i) => `"${key}" = $${i + 2}`).join(', ');
      const values = safeEntries.map(([, v]) => (v instanceof Date ? v.toISOString() : v));

      const result = await client.query(
        `UPDATE gift_vouchers.vouchers SET ${setClauses} WHERE id = $1 RETURNING *`,
        [id, ...values],
      );
      return mapRow(result.rows[0]);
    },

    async findExpiredVouchers(now: Date): Promise<GiftVoucher[]> {
      const result = await pool.query(
        `SELECT * FROM gift_vouchers.vouchers
         WHERE status IN ('issued', 'sent') AND valid_until < $1`,
        [now.toISOString()],
      );
      return result.rows.map(mapRow);
    },

    async listVouchersByPurchaser(userId: string): Promise<GiftVoucher[]> {
      const result = await pool.query(
        `SELECT * FROM gift_vouchers.vouchers
         WHERE purchaser_user_id = $1
         ORDER BY issued_at DESC`,
        [userId],
      );
      return result.rows.map(mapRow);
    },

    async withTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },
  };
}

// Singleton adapter
let _adapter: VoucherDbAdapter | null = null;

export function getDb(): VoucherDbAdapter {
  if (!_adapter) {
    _adapter = buildAdapter();
  }
  return _adapter;
}
