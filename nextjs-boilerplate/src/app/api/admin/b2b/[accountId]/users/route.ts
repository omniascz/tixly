import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requirePlatformAdmin } from '@/lib/platform-auth';
import { db } from '@/lib/db/rls-pool';

const addSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(200),
  monthlyLimitHalire: z.number().int().positive().optional(),
  isAdmin: z.boolean().optional(),
});

const deleteSchema = z.object({
  userId: z.string().uuid(),
});

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ accountId: string }> },
): Promise<Response> {
  const admin = await requirePlatformAdmin(req);
  if (!admin) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  const { accountId } = await params;

  const res = await db().query(
    `SELECT id, account_id, email, name, monthly_limit_halire, is_admin, joined_at, created_at
     FROM platform.b2b_account_users
     WHERE account_id = $1
     ORDER BY created_at`,
    [accountId],
  );

  return NextResponse.json({ users: res.rows });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ accountId: string }> },
): Promise<Response> {
  const admin = await requirePlatformAdmin(req);
  if (!admin) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  const { accountId } = await params;

  const body: unknown = await req.json().catch(() => null);
  const parsed = addSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'VALIDATION_FAILED', issues: parsed.error.issues }, { status: 422 });
  }
  const d = parsed.data;

  const res = await db().query<{ id: string; invite_token: string }>(
    `INSERT INTO platform.b2b_account_users
       (account_id, email, name, monthly_limit_halire, is_admin)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, invite_token`,
    [accountId, d.email.toLowerCase(), d.name, d.monthlyLimitHalire ?? null, d.isAdmin ?? false],
  );

  const row = res.rows[0];
  console.log(`B2B invite: ${d.email} → token=${row.invite_token}`);

  return NextResponse.json({ user: row }, { status: 201 });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ accountId: string }> },
): Promise<Response> {
  const admin = await requirePlatformAdmin(req);
  if (!admin) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  const { accountId } = await params;

  const body: unknown = await req.json().catch(() => null);
  const parsed = deleteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'VALIDATION_FAILED', issues: parsed.error.issues }, { status: 422 });
  }

  const res = await db().query(
    `DELETE FROM platform.b2b_account_users WHERE id = $1 AND account_id = $2`,
    [parsed.data.userId, accountId],
  );

  if (res.rowCount === 0) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });

  return NextResponse.json({ ok: true });
}
