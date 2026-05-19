/**
 * GET  /api/admin/member-groups — list groups + member counts
 * POST /api/admin/member-groups — create group
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

const createSchema = z.object({
  slug: z.string().min(2).max(40).regex(/^[a-z0-9-]+$/),
  name: z.string().min(2).max(120),
  description: z.string().max(1000).nullable().optional(),
});

export async function GET(req: NextRequest): Promise<Response> {
  const promoter = await requirePromoter(req);
  if (!promoter) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const r = await db().query<{
    id: string;
    slug: string;
    name: string;
    description: string | null;
    member_count: number;
    rules_count: number;
  }>(
    `SELECT g.id, g.slug, g.name, g.description,
            (SELECT COUNT(*)::int FROM platform.member_group_users WHERE group_id = g.id) AS member_count,
            (SELECT COUNT(*)::int FROM catalog.member_pricing_rules WHERE group_id = g.id AND active) AS rules_count
     FROM platform.member_groups g
     WHERE g.promoter_id = $1 AND g.active = true
     ORDER BY g.name`,
    [promoter.promoterId],
  );
  return NextResponse.json({ groups: r.rows });
}

export async function POST(req: NextRequest): Promise<Response> {
  const promoter = await requirePromoter(req);
  if (!promoter || promoter.status !== 'active' || promoter.role === 'staff') {
    return NextResponse.json({ error: 'ADMIN_OR_OWNER_ONLY' }, { status: 403 });
  }
  const body = await req.json().catch(() => ({}));
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.issues },
      { status: 422 },
    );
  }
  try {
    const r = await db().query<{ id: string }>(
      `INSERT INTO platform.member_groups (promoter_id, slug, name, description)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [promoter.promoterId, parsed.data.slug, parsed.data.name, parsed.data.description ?? null],
    );
    return NextResponse.json({ id: r.rows[0].id }, { status: 201 });
  } catch (err) {
    if ((err as { code?: string }).code === '23505') {
      return NextResponse.json({ error: 'SLUG_TAKEN' }, { status: 409 });
    }
    throw err;
  }
}
