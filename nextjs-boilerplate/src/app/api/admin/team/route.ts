/**
 * GET  /api/admin/team — list all members + pending invites pro promotér
 * POST /api/admin/team — invite (owner-only): { email, role }
 *
 * Role hierarchy: owner > admin > staff
 *  - owner: vše + invitations + remove
 *  - admin: events/orders CRUD, no team management
 *  - staff: scanner + read-only orders
 */

import { randomBytes } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { z } from 'zod';
import { requirePromoter } from '@/lib/admin-auth';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

const INVITE_TTL_HOURS = 168; // 7 days

interface MemberRow {
  user_id: string;
  email: string;
  name: string | null;
  role: string;
  status: string;
  created_at: string;
}

interface InviteRow {
  id: string;
  email: string;
  role: string;
  expires_at: string;
  invited_by_email: string;
  created_at: string;
}

export async function GET(req: NextRequest): Promise<Response> {
  const promoter = await requirePromoter(req);
  if (!promoter) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const [members, invites] = await Promise.all([
    db().query<MemberRow>(
      `SELECT pm.user_id, u.email, u.name, pm.role::text AS role, pm.status, pm.created_at
       FROM platform.promoter_members pm
       JOIN identity.users u ON u.id = pm.user_id
       WHERE pm.promoter_id = $1
       ORDER BY pm.created_at ASC`,
      [promoter.promoterId],
    ),
    db().query<InviteRow>(
      `SELECT i.id, i.email, i.role::text AS role, i.expires_at,
              u.email AS invited_by_email, i.created_at
       FROM platform.team_invites i
       JOIN identity.users u ON u.id = i.invited_by_user_id
       WHERE i.promoter_id = $1
         AND i.accepted_at IS NULL AND i.revoked_at IS NULL
         AND i.expires_at > NOW()
       ORDER BY i.created_at DESC`,
      [promoter.promoterId],
    ),
  ]);

  return NextResponse.json({
    members: members.rows,
    invites: invites.rows,
  });
}

const inviteSchema = z.object({
  email: z.string().email().max(200),
  role: z.enum([
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

export async function POST(req: NextRequest): Promise<Response> {
  const promoter = await requirePromoter(req);
  if (!promoter || promoter.status !== 'active' || promoter.role !== 'owner') {
    return NextResponse.json(
      { error: 'OWNER_ONLY', message: 'Pouze owner může pozvat členy.' },
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

  // Pokud uživatel už je členem, neodesíláme invite
  const existing = await db().query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM platform.promoter_members pm
     JOIN identity.users u ON u.id = pm.user_id
     WHERE pm.promoter_id = $1 AND LOWER(u.email) = LOWER($2)`,
    [promoter.promoterId, parsed.data.email],
  );
  if (Number(existing.rows[0]?.count ?? 0) > 0) {
    return NextResponse.json(
      { error: 'ALREADY_MEMBER', message: 'Tento e-mail už je členem týmu.' },
      { status: 409 },
    );
  }

  // Aktivní invite čekající?
  const pending = await db().query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM platform.team_invites
     WHERE promoter_id = $1 AND LOWER(email) = LOWER($2)
       AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > NOW()`,
    [promoter.promoterId, parsed.data.email],
  );
  if (Number(pending.rows[0]?.count ?? 0) > 0) {
    return NextResponse.json(
      { error: 'INVITE_PENDING', message: 'Invite už čeká na přijetí.' },
      { status: 409 },
    );
  }

  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + INVITE_TTL_HOURS * 60 * 60 * 1000);

  const r = await db().query<{ id: string }>(
    `INSERT INTO platform.team_invites
       (promoter_id, invited_by_user_id, email, role, token, expires_at)
     VALUES ($1, $2, $3, $4::platform.member_role, $5, $6)
     RETURNING id`,
    [
      promoter.promoterId,
      promoter.userId,
      parsed.data.email.toLowerCase(),
      parsed.data.role,
      token,
      expiresAt.toISOString(),
    ],
  );

  // Send email via internal webhook (mock-friendly)
  const inviteUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'}/team/accept?token=${token}`;
  void fetch(
    `${process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'}/api/internal/team-invite-email`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-token': process.env.INTERNAL_SERVICE_TOKEN ?? '',
      },
      body: JSON.stringify({
        toEmail: parsed.data.email,
        promoterName: promoter.promoterName,
        role: parsed.data.role,
        inviteUrl,
      }),
    },
  ).catch((err) => console.error('[team invite email]', err));

  return NextResponse.json(
    { id: r.rows[0].id, inviteUrl, expiresAt: expiresAt.toISOString() },
    { status: 201 },
  );
}
