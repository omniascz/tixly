/**
 * PATCH  /api/admin/team/[memberId] — change role
 * DELETE /api/admin/team/[memberId] — remove from team (cannot remove last owner)
 *
 * memberId = user_id v platform.promoter_members
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

const patchSchema = z.object({
  role: z.enum([
    'owner',
    'admin',
    'manager',
    'finance',
    'marketing',
    'staff',
    'gate',
    'box_office',
    'accreditation_manager',
  ]),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: { memberId: string } },
): Promise<Response> {
  const promoter = await requirePromoter(req);
  if (!promoter || promoter.role !== 'owner') {
    return NextResponse.json({ error: 'OWNER_ONLY' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed' }, { status: 422 });
  }

  // Last-owner protection: pokud snižujeme owner→admin a je to poslední owner
  if (parsed.data.role !== 'owner') {
    const ownerCount = await db().query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM platform.promoter_members
       WHERE promoter_id = $1 AND role = 'owner' AND status = 'active'`,
      [promoter.promoterId],
    );
    const isTargetOwner = await db().query<{ role: string }>(
      `SELECT role::text AS role FROM platform.promoter_members
       WHERE promoter_id = $1 AND user_id = $2`,
      [promoter.promoterId, params.memberId],
    );
    if (
      Number(ownerCount.rows[0]?.count ?? 0) <= 1 &&
      isTargetOwner.rows[0]?.role === 'owner'
    ) {
      return NextResponse.json(
        { error: 'CANNOT_DEMOTE_LAST_OWNER' },
        { status: 409 },
      );
    }
  }

  const r = await db().query<{ user_id: string }>(
    `UPDATE platform.promoter_members
     SET role = $3::platform.member_role, updated_at = NOW()
     WHERE promoter_id = $1 AND user_id = $2
     RETURNING user_id`,
    [promoter.promoterId, params.memberId, parsed.data.role],
  );
  if (r.rows.length === 0) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { memberId: string } },
): Promise<Response> {
  const promoter = await requirePromoter(req);
  if (!promoter || promoter.role !== 'owner') {
    return NextResponse.json({ error: 'OWNER_ONLY' }, { status: 403 });
  }
  // Prevent self-removal that would orphan promotér
  if (params.memberId === promoter.userId) {
    const ownerCount = await db().query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM platform.promoter_members
       WHERE promoter_id = $1 AND role = 'owner' AND status = 'active'`,
      [promoter.promoterId],
    );
    if (Number(ownerCount.rows[0]?.count ?? 0) <= 1) {
      return NextResponse.json(
        { error: 'CANNOT_REMOVE_LAST_OWNER' },
        { status: 409 },
      );
    }
  }

  const r = await db().query<{ user_id: string }>(
    `DELETE FROM platform.promoter_members
     WHERE promoter_id = $1 AND user_id = $2
     RETURNING user_id`,
    [promoter.promoterId, params.memberId],
  );
  if (r.rows.length === 0) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
