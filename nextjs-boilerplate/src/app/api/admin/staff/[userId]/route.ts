/**
 * PATCH  /api/admin/staff/[userId] — change role
 * DELETE /api/admin/staff/[userId] — remove member
 *
 * Auth: requirePromoter, jen 'owner'. Owner nemůže odebrat sám sebe.
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsPromoterOwner } from '@/lib/admin-auth';
import { z } from 'zod';


const patchSchema = z.object({
  role: z.enum(['admin', 'staff']),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: { userId: string } },
): Promise<Response> {
  return runAsPromoterOwner(req, async (promoter) => {
  if (!/^[0-9a-f-]{36}$/i.test(params.userId)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 422 });
  }
  if (params.userId === promoter.userId) {
    return NextResponse.json(
      { error: 'CANNOT_DEMOTE_SELF', message: 'Owner si nemůže měnit roli.' },
      { status: 409 },
    );
  }

  const body: unknown = await req.json().catch(() => ({}));
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed' }, { status: 422 });
  }

  const r = await db().query<{ user_id: string }>(
    `UPDATE platform.promoter_members
     SET role = $1, updated_at = NOW()
     WHERE promoter_id = $2 AND user_id = $3 AND role <> 'owner'
     RETURNING user_id`,
    [parsed.data.role, promoter.promoterId, params.userId],
  );
  if (r.rows.length === 0) {
    return NextResponse.json({ error: 'NOT_FOUND_OR_OWNER' }, { status: 404 });
  }
  return NextResponse.json({ ok: true });

  });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { userId: string } },
): Promise<Response> {
  return runAsPromoterOwner(req, async (promoter) => {
  if (!/^[0-9a-f-]{36}$/i.test(params.userId)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 422 });
  }
  if (params.userId === promoter.userId) {
    return NextResponse.json(
      { error: 'CANNOT_REMOVE_SELF', message: 'Owner se nemůže odebrat. Pro převod ownership kontaktuj support.' },
      { status: 409 },
    );
  }

  const r = await db().query<{ user_id: string }>(
    `DELETE FROM platform.promoter_members
     WHERE promoter_id = $1 AND user_id = $2 AND role <> 'owner'
     RETURNING user_id`,
    [promoter.promoterId, params.userId],
  );
  if (r.rows.length === 0) {
    return NextResponse.json({ error: 'NOT_FOUND_OR_OWNER' }, { status: 404 });
  }
  return NextResponse.json({ ok: true });

  });
}
