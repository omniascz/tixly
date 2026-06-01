/**
 * POST /api/buyer/gdpr/delete — žádost o smazání (s 30-day grace period)
 * GET  /api/buyer/gdpr/delete — status existující žádosti
 * DELETE /api/buyer/gdpr/delete — cancel žádost (před uplynutím grace period)
 *
 * Po grace period cron `/api/internal/cron/process-gdpr-deletions` provede
 * actual anonymization (users.anonymized_at + scrub PII).
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsUser } from '@/lib/auth';


const GRACE_DAYS = 30;

export async function GET(req: NextRequest): Promise<Response> {
  return runAsUser(req, async (userId) => {
  const r = await db().query<{
    id: string;
    status: string;
    scheduled_at: string | null;
    created_at: string;
  }>(
    `SELECT id, status, scheduled_at, created_at
     FROM identity.gdpr_requests
     WHERE user_id = $1 AND type = 'deletion'
     ORDER BY created_at DESC
     LIMIT 1`,
    [userId],
  );
  return NextResponse.json({ request: r.rows[0] ?? null });

  });
}

export async function POST(req: NextRequest): Promise<Response> {
  return runAsUser(req, async (userId) => {
  const existing = await db().query<{ id: string; status: string }>(
    `SELECT id, status FROM identity.gdpr_requests
     WHERE user_id = $1 AND type = 'deletion' AND status IN ('pending', 'processing')`,
    [userId],
  );
  if (existing.rows.length > 0) {
    return NextResponse.json(
      { error: 'ALREADY_REQUESTED', status: existing.rows[0].status },
      { status: 409 },
    );
  }

  const scheduledAt = new Date(Date.now() + GRACE_DAYS * 24 * 60 * 60 * 1000);
  const r = await db().query<{ id: string }>(
    `INSERT INTO identity.gdpr_requests (user_id, type, status, scheduled_at)
     VALUES ($1, 'deletion', 'pending', $2)
     RETURNING id`,
    [userId, scheduledAt.toISOString()],
  );
  return NextResponse.json({
    id: r.rows[0].id,
    status: 'pending',
    scheduledAt: scheduledAt.toISOString(),
    graceDays: GRACE_DAYS,
  });

  });
}

export async function DELETE(req: NextRequest): Promise<Response> {
  return runAsUser(req, async (userId) => {
  const r = await db().query(
    `UPDATE identity.gdpr_requests
     SET status = 'cancelled', cancelled_at = NOW(), cancelled_by_user_id = $1
     WHERE user_id = $1 AND type = 'deletion' AND status = 'pending'
     RETURNING id`,
    [userId],
  );
  if (r.rowCount === 0) {
    return NextResponse.json({ error: 'NO_PENDING_REQUEST' }, { status: 404 });
  }
  return NextResponse.json({ ok: true });

  });
}
