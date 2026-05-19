/**
 * GET  /api/admin/member-groups/[groupId]/users — list members
 * POST /api/admin/member-groups/[groupId]/users — bulk add (CSV-style nebo per-row)
 *
 * Body: { members: [{ email, memberNumber?, validFrom?, validUntil? }, ...] }
 *   max 1000 per request.
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

const memberSchema = z.object({
  email: z.string().email().max(200),
  memberNumber: z.string().max(50).optional(),
  validFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  validUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const postSchema = z.object({
  members: z.array(memberSchema).min(1).max(1000),
});

export async function GET(
  req: NextRequest,
  { params }: { params: { groupId: string } },
): Promise<Response> {
  const promoter = await requirePromoter(req);
  if (!promoter) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Ownership
  const owns = await db().query(
    `SELECT 1 FROM platform.member_groups WHERE id = $1 AND promoter_id = $2`,
    [params.groupId, promoter.promoterId],
  );
  if (owns.rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const r = await db().query<{
    id: string;
    email: string;
    member_number: string | null;
    valid_from: string | null;
    valid_until: string | null;
    created_at: string;
  }>(
    `SELECT id, email, member_number, valid_from, valid_until, created_at
     FROM platform.member_group_users
     WHERE group_id = $1
     ORDER BY created_at DESC
     LIMIT 5000`,
    [params.groupId],
  );
  return NextResponse.json({ members: r.rows });
}

export async function POST(
  req: NextRequest,
  { params }: { params: { groupId: string } },
): Promise<Response> {
  const promoter = await requirePromoter(req);
  if (!promoter || promoter.status !== 'active' || promoter.role === 'staff') {
    return NextResponse.json({ error: 'ADMIN_OR_OWNER_ONLY' }, { status: 403 });
  }

  const owns = await db().query(
    `SELECT 1 FROM platform.member_groups WHERE id = $1 AND promoter_id = $2`,
    [params.groupId, promoter.promoterId],
  );
  if (owns.rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const parsed = postSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.issues },
      { status: 422 },
    );
  }

  let inserted = 0;
  let updated = 0;
  for (const m of parsed.data.members) {
    const r = await db().query<{ created: boolean }>(
      `INSERT INTO platform.member_group_users
         (group_id, email, member_number, valid_from, valid_until)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (group_id, LOWER(email)) DO UPDATE
         SET member_number = EXCLUDED.member_number,
             valid_from = EXCLUDED.valid_from,
             valid_until = EXCLUDED.valid_until
       RETURNING (xmax = 0) AS created`,
      [
        params.groupId,
        m.email.toLowerCase(),
        m.memberNumber ?? null,
        m.validFrom ?? null,
        m.validUntil ?? null,
      ],
    );
    if (r.rows[0].created) inserted += 1;
    else updated += 1;
  }
  return NextResponse.json({ ok: true, inserted, updated });
}
