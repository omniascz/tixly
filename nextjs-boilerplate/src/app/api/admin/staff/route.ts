/**
 * GET  /api/admin/staff — list členů promotéra
 * POST /api/admin/staff — invite (přidá existing user-a podle e-mailu, status='active' pro demo)
 *
 * Auth: requirePromoter, jen owner role může spravovat staff.
 *
 * Demo zjednodušení: žádné e-mailové pozvánky (tj. žádný invite token).
 * Po POSTu se rovnou přidá platform.promoter_members entry (user musí
 * existovat — typicky se zaregistroval přes /register). V produkci
 * implementovat plný invite flow s expirujícím tokenem.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { Pool } from 'pg';
import { requirePromoter } from '@/lib/admin-auth';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

interface MemberRow {
  user_id: string;
  email: string;
  name: string | null;
  role: 'owner' | 'admin' | 'staff';
  status: string;
  created_at: string;
}

export async function GET(req: NextRequest): Promise<Response> {
  const promoter = await requirePromoter(req);
  if (!promoter) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const r = await db().query<MemberRow>(
    `SELECT m.user_id, u.email, u.name, m.role, m.status, m.created_at
     FROM platform.promoter_members m
     JOIN identity.users u ON u.id = m.user_id
     WHERE m.promoter_id = $1
     ORDER BY
       CASE m.role
         WHEN 'owner' THEN 1
         WHEN 'admin' THEN 2
         WHEN 'staff' THEN 3
       END, u.email`,
    [promoter.promoterId],
  );
  return NextResponse.json({
    currentUserId: promoter.userId,
    currentRole: promoter.role,
    members: r.rows.map((m) => ({
      userId: m.user_id,
      email: m.email,
      name: m.name,
      role: m.role,
      status: m.status,
      createdAt: m.created_at,
    })),
  });
}

const inviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(['admin', 'staff']),
});

export async function POST(req: NextRequest): Promise<Response> {
  const promoter = await requirePromoter(req);
  if (!promoter || promoter.status !== 'active') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (promoter.role !== 'owner') {
    return NextResponse.json(
      { error: 'OWNER_ONLY', message: 'Jen owner může pozvat členy.' },
      { status: 403 },
    );
  }

  const body = await req.json().catch(() => ({}));
  const parsed = inviteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.issues },
      { status: 422 },
    );
  }
  const input = parsed.data;

  // Najdi user-a podle e-mailu (musí být registrovaný)
  const userRes = await db().query<{ id: string; name: string | null }>(
    `SELECT id, name FROM identity.users
     WHERE email = $1 AND anonymized_at IS NULL
     LIMIT 1`,
    [input.email.toLowerCase()],
  );
  if (userRes.rows.length === 0) {
    return NextResponse.json(
      {
        error: 'USER_NOT_FOUND',
        message: `Uživatel s e-mailem "${input.email}" se musí nejdříve zaregistrovat na /register.`,
      },
      { status: 404 },
    );
  }
  const targetUserId = userRes.rows[0]!.id;

  // Already member?
  const existingRes = await db().query<{ role: string }>(
    `SELECT role FROM platform.promoter_members
     WHERE promoter_id = $1 AND user_id = $2`,
    [promoter.promoterId, targetUserId],
  );
  if (existingRes.rows.length > 0) {
    return NextResponse.json(
      {
        error: 'ALREADY_MEMBER',
        message: `Tento uživatel je už členem (role: ${existingRes.rows[0]!.role}).`,
      },
      { status: 409 },
    );
  }

  await db().query(
    `INSERT INTO platform.promoter_members (promoter_id, user_id, role, status)
     VALUES ($1, $2, $3, 'active')`,
    [promoter.promoterId, targetUserId, input.role],
  );

  return NextResponse.json({ ok: true, userId: targetUserId, role: input.role }, { status: 201 });
}
