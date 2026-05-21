/**
 * POST   /api/admin/event-groups/[id]/shares
 *   — Owner promotér sdílí group s jiným promotérem (cross-org delegation)
 *
 * Body: {
 *   sharedWithPromoterId,
 *   canEditEvents?, canPublish?, canManageInventory?, canScan?, canViewReports?,
 *   expiresAt? (ISO datetime),
 *   notes?
 * }
 *
 * Vrátí share record. Shared partner musí accept POST /accept (separate endpoint).
 */
import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { z } from 'zod';
import { requirePromoter } from '@/lib/admin-auth';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

const schema = z.object({
  sharedWithPromoterId: z.string().uuid(),
  canEditEvents: z.boolean().default(false),
  canPublish: z.boolean().default(false),
  canManageInventory: z.boolean().default(true),
  canScan: z.boolean().default(true),
  canViewReports: z.boolean().default(true),
  expiresAt: z.string().datetime().optional(),
  notes: z.string().max(1000).optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const promoter = await requirePromoter(req);
  if (!promoter || promoter.role !== 'owner') {
    return NextResponse.json({ error: 'OWNER_ONLY' }, { status: 403 });
  }
  const { id: groupId } = await params;

  const body: unknown = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'INVALID_BODY' }, { status: 422 });
  }
  const d = parsed.data;

  // Verify ownership
  const ownRes = await db().query(
    `SELECT 1 FROM event_groups.groups WHERE id = $1 AND promoter_id = $2`,
    [groupId, promoter.promoterId],
  );
  if (ownRes.rows.length === 0) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }

  // Can't share with yourself
  if (d.sharedWithPromoterId === promoter.promoterId) {
    return NextResponse.json({ error: 'CANNOT_SHARE_WITH_SELF' }, { status: 422 });
  }

  // Verify target promotér exists + active
  const targetRes = await db().query(
    `SELECT 1 FROM platform.promoters WHERE id = $1 AND status = 'active'`,
    [d.sharedWithPromoterId],
  );
  if (targetRes.rows.length === 0) {
    return NextResponse.json({ error: 'TARGET_PROMOTER_NOT_FOUND' }, { status: 404 });
  }

  try {
    const r = await db().query<{ id: string }>(
      `INSERT INTO event_groups.shares
         (group_id, owner_promoter_id, shared_with_promoter_id,
          can_edit_events, can_publish, can_manage_inventory, can_scan, can_view_reports,
          expires_at, created_by_user_id, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::timestamptz, $10, $11)
       RETURNING id`,
      [
        groupId, promoter.promoterId, d.sharedWithPromoterId,
        d.canEditEvents, d.canPublish, d.canManageInventory, d.canScan, d.canViewReports,
        d.expiresAt ?? null, promoter.userId, d.notes ?? null,
      ],
    );

    return NextResponse.json({ id: r.rows[0].id, status: 'pending' }, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('duplicate')) {
      return NextResponse.json({ error: 'ALREADY_SHARED' }, { status: 409 });
    }
    console.error('[shares POST]', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const promoter = await requirePromoter(req);
  if (!promoter || promoter.role !== 'owner') {
    return NextResponse.json({ error: 'OWNER_ONLY' }, { status: 403 });
  }
  const { id: groupId } = await params;
  const shareId = req.nextUrl.searchParams.get('shareId');
  if (!shareId || !/^[0-9a-f-]{36}$/i.test(shareId)) {
    return NextResponse.json({ error: 'INVALID_SHARE_ID' }, { status: 400 });
  }

  await db().query(
    `UPDATE event_groups.shares
        SET status = 'revoked', revoked_at = NOW()
      WHERE id = $1 AND group_id = $2 AND owner_promoter_id = $3`,
    [shareId, groupId, promoter.promoterId],
  );

  return NextResponse.json({ ok: true });
}
