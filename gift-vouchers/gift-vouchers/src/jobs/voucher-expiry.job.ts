// Cron job — expires overdue gift vouchers once per day at 02:00.
// Runs as a standalone Node.js process; not part of the Next.js request lifecycle.
//
// Usage:
//   node dist/jobs/voucher-expiry.job.js
//
// Environment variables required (same as the main app):
//   DATABASE_URL — PostgreSQL connection string

import { GiftVoucherService } from '../services/gift-voucher.service';

// ---------------------------------------------------------------------------
// Minimal DB adapter backed by node-postgres (pg).
// Replace with your real pool/adapter in production.
// ---------------------------------------------------------------------------

// We import pg dynamically so that test environments that don't have it
// installed don't fail at module load time.
async function buildDbAdapter() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Pool } = require('pg') as typeof import('pg');

  const pool = new Pool({ connectionString: process.env['DATABASE_URL'] });

  const adapter = {
    async findVoucherByCode() { return null; },
    async findVoucherById() { return null; },
    async createVoucher() { throw new Error('Not implemented in job context'); },

    async updateVoucher(id: string, data: Record<string, unknown>) {
      const setClauses = Object.keys(data)
        .map((key, i) => `"${key}" = $${i + 2}`)
        .join(', ');
      const values = Object.values(data);

      const result = await pool.query(
        `UPDATE gift_vouchers.vouchers SET ${setClauses} WHERE id = $1 RETURNING *`,
        [id, ...values],
      );
      return result.rows[0];
    },

    async findExpiredVouchers(now: Date) {
      const result = await pool.query(
        `SELECT * FROM gift_vouchers.vouchers
         WHERE status IN ('issued', 'sent')
           AND valid_until < $1`,
        [now.toISOString()],
      );
      return result.rows;
    },

    async listVouchersByPurchaser() { return []; },

    async withTransaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
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

  return { pool, adapter };
}

// ---------------------------------------------------------------------------
// Job runner
// ---------------------------------------------------------------------------

async function runJob(): Promise<void> {
  console.info(`[voucher-expiry] Starting at ${new Date().toISOString()}`);

  const { pool, adapter } = await buildDbAdapter();
  const service = new GiftVoucherService();

  try {
    const count = await service.expireVouchers(adapter);
    console.info(`[voucher-expiry] Expired ${count} voucher(s).`);
  } finally {
    await pool.end();
  }
}

// ---------------------------------------------------------------------------
// Cron schedule — 02:00 every day
// ---------------------------------------------------------------------------

// We use a simple interval-based approach so there is no additional dependency.
// For production prefer a proper cron library (node-cron, croner) or an
// external scheduler (Kubernetes CronJob, GitHub Actions, etc.).

function msUntilNextRun(hour: number, minute: number): number {
  const now = new Date();
  const next = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      hour,
      minute,
      0,
      0,
    ),
  );
  if (next.getTime() <= now.getTime()) {
    // Already passed today — schedule for tomorrow
    next.setUTCDate(next.getUTCDate() + 1);
  }
  return next.getTime() - now.getTime();
}

let scheduled: NodeJS.Timeout | null = null;

function scheduleNext(): void {
  const delay = msUntilNextRun(2, 0);
  console.info(
    `[voucher-expiry] Next run in ${Math.round(delay / 1000 / 60)} minute(s) ` +
    `(${new Date(Date.now() + delay).toISOString()})`,
  );

  scheduled = setTimeout(async () => {
    try {
      await runJob();
    } catch (err) {
      console.error('[voucher-expiry] Job failed:', err);
    }
    scheduleNext();
  }, delay);
}

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

function shutdown(signal: string): void {
  console.info(`[voucher-expiry] Received ${signal}, shutting down gracefully.`);
  if (scheduled !== null) {
    clearTimeout(scheduled);
  }
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Start
scheduleNext();
