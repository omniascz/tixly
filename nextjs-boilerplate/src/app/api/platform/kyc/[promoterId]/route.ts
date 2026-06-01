/**
 * POST /api/platform/kyc/[promoterId]
 * Body: { decision: 'approve' | 'reject', rejectionReason? }
 *
 * Schválení = promoter status='active' (může vytvářet akce). Reject vyžaduje reason.
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsPlatformAdmin } from '@/lib/platform-auth';
import { z } from 'zod';


const schema = z.discriminatedUnion('decision', [
  z.object({ decision: z.literal('approve') }),
  z.object({
    decision: z.literal('reject'),
    rejectionReason: z.string().min(2).max(500),
  }),
]);

export async function POST(
  req: NextRequest,
  { params }: { params: { promoterId: string } },
): Promise<Response> {
  return runAsPlatformAdmin(req, async (admin) => {
  const body: unknown = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed' }, { status: 422 });
  }

  if (parsed.data.decision === 'approve') {
    await db().query(
      `UPDATE platform.promoters
       SET kyc_status = 'approved', kyc_reviewed_at = NOW(),
           kyc_reviewed_by_user_id = $2, status = 'active', updated_at = NOW()
       WHERE id = $1 AND kyc_status = 'submitted'`,
      [params.promoterId, admin.userId],
    );
  } else {
    await db().query(
      `UPDATE platform.promoters
       SET kyc_status = 'rejected', kyc_reviewed_at = NOW(),
           kyc_reviewed_by_user_id = $2, kyc_rejection_reason = $3, updated_at = NOW()
       WHERE id = $1 AND kyc_status = 'submitted'`,
      [params.promoterId, admin.userId, parsed.data.rejectionReason],
    );
  }

  const { logAction, extractRequestContext } = await import('@/lib/audit/log');
  const reqCtx = extractRequestContext(req);
  void logAction({
    actorUserId: admin.userId,
    actorRole: 'platform_admin',
    action: `kyc.${parsed.data.decision}`,
    targetType: 'promoter',
    targetId: params.promoterId,
    metadata:
      parsed.data.decision === 'reject'
        ? { rejectionReason: parsed.data.rejectionReason }
        : {},
    ip: reqCtx.ip,
    userAgent: reqCtx.userAgent,
  });

  return NextResponse.json({ ok: true });

  });
}
