/**
 * POST /api/platform/verifications/[id]
 * Body: { decision: 'approve' | 'reject', rejectionReason?, expiresAt? }
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsPlatformAdmin } from '@/lib/platform-auth';
import { z } from 'zod';


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

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }): Promise<Response> {
  const params = await props.params;
  return runAsPlatformAdmin(req, async (admin) => {
  const body: unknown = await req.json().catch(() => ({}));
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

  });
}
