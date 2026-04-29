/**
 * POST /api/internal/cron/process-gdpr-deletions
 *
 * Find pending deletion requests where scheduled_at <= NOW(),
 * scrub PII (users.anonymized_at, email, name, phone), mark request completed.
 *
 * Auth: x-internal-token.
 */

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { timingSafeEqual } from 'crypto';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export async function POST(req: NextRequest): Promise<Response> {
  const token = req.headers.get('x-internal-token') ?? '';
  const expected = process.env.INTERNAL_SERVICE_TOKEN ?? '';
  if (!expected || !safeEqual(token, expected)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const due = await db().query<{ id: string; user_id: string }>(
    `SELECT id, user_id FROM identity.gdpr_requests
     WHERE type = 'deletion' AND status = 'pending' AND scheduled_at <= NOW()
     LIMIT 100`,
  );

  let processed = 0;
  for (const row of due.rows) {
    const client = await db().connect();
    try {
      await client.query('BEGIN');
      // Scrub PII
      await client.query(
        `UPDATE identity.users
         SET email = 'anonymized-' || id || '@deleted.tixly.cz',
             name = 'Anonymized',
             phone = NULL,
             password_hash = '!deleted',
             anonymized_at = NOW(),
             updated_at = NOW()
         WHERE id = $1`,
        [row.user_id],
      );
      await client.query(
        `UPDATE identity.gdpr_requests
         SET status = 'completed', completed_at = NOW()
         WHERE id = $1`,
        [row.id],
      );
      await client.query('COMMIT');
      processed += 1;
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('[gdpr deletion]', row.id, err);
    } finally {
      client.release();
    }
  }

  return NextResponse.json({ ok: true, processed });
}
