/**
 * PATCH /api/admin/partner-applications/[id]
 *
 * Body: { action: 'approve' | 'reject', commissionPct?: number, tokenLabel?: string }
 * approve → status='active', generates first partner token (returned once)
 * reject  → status='terminated'
 *
 * Auth: platform admin JWT
 */
import { NextRequest, NextResponse } from 'next/server';
import { db, runWithPlatformAdminContext } from '@/lib/db/rls-pool';
import { requirePlatformAdmin } from '@/lib/platform-auth';
import { generatePartnerToken } from '@/lib/partner/auth';
import { z } from 'zod';

const schema = z.discriminatedUnion('action', [
  z.object({
    action:        z.literal('approve'),
    commissionPct: z.number().min(0).max(50).optional(),
    tokenLabel:    z.string().min(1).max(120).optional(),
  }),
  z.object({ action: z.literal('reject') }),
]);

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  const admin = await requirePlatformAdmin(req);
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  return runWithPlatformAdminContext(async () => {
    const body: unknown = await req.json().catch(() => ({}));
    const parsed = schema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 422 });

    const partnerR = await db().query<{ id: string; status: string }>(
      `SELECT id, status FROM partner.partners WHERE id = $1`,
      [params.id],
    );
    if (!partnerR.rows[0]) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (partnerR.rows[0].status !== 'pending') {
      return NextResponse.json({ error: 'ALREADY_PROCESSED', status: partnerR.rows[0].status }, { status: 409 });
    }

    if (parsed.data.action === 'reject') {
      await db().query(
        `UPDATE partner.partners SET status = 'terminated', updated_at = NOW() WHERE id = $1`,
        [params.id],
      );
      return NextResponse.json({ ok: true, status: 'terminated' });
    }

    // approve
    const commission = parsed.data.commissionPct ?? 5;
    await db().query(
      `UPDATE partner.partners SET status = 'active', commission_pct = $2, updated_at = NOW() WHERE id = $1`,
      [params.id, commission],
    );

    const { token, hash } = generatePartnerToken();
    const label = parsed.data.tokenLabel ?? 'Primary';

    await db().query(
      `INSERT INTO partner.partner_tokens (partner_id, token_hash, label) VALUES ($1, $2, $3)`,
      [params.id, hash, label],
    );

    return NextResponse.json({
      ok: true,
      status: 'active',
      partnerToken: token, // raw — shown once, then only hash stored
      commissionPct: commission,
    });
  });
}
