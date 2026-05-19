/**
 * POST /api/platform/verifications/[id]
 * Body: { decision: 'approve' | 'reject', rejectionReason?, expiresAt? }
 */

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { z } from 'zod';
import { requirePlatformAdmin } from '@/lib/platform-auth';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

const schema = z.discriminatedUnion('decision', [
  z.object({
    decision: z.literal('approve'),
    expiresAt: z.string().datetime().nullable().optional(),
  }),
  z.object({
    decision: z.literal('reject'),
    rejectionReason: z.string().min(2).max(500),
  }),
]);

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  const admin = await requirePlatformAdmin(req);
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.issues },
      { status: 422 },
    );
  }

  if (parsed.data.decision === 'approve') {
    await db().query(
      `UPDATE identity.discount_verifications
       SET status = 'verified', verified_at = NOW(), verified_by_user_id = $2,
           expires_at = $3
       WHERE id = $1 AND status = 'pending'`,
      [params.id, admin.userId, parsed.data.expiresAt ?? null],
    );
  } else {
    await db().query(
      `UPDATE identity.discount_verifications
       SET status = 'rejected', verified_at = NOW(), verified_by_user_id = $2,
           rejection_reason = $3
       WHERE id = $1 AND status = 'pending'`,
      [params.id, admin.userId, parsed.data.rejectionReason],
    );
  }
  return NextResponse.json({ ok: true });
}
