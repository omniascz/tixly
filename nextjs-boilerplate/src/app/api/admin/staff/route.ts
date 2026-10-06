/**
 * GET  /api/admin/staff — list členů promotéra + pending e-mailové pozvánky
 * POST /api/admin/staff — invite (owner-only): { email, role }
 *
 * Auth: requirePromoter, jen owner role může spravovat staff.
 *
 * E-mailový invite flow (sdílí infrastrukturu s /api/admin/team):
 *   1. Owner pozve podle e-mailu + role — adresát NEMUSÍ být registrovaný.
 *   2. Uloží se pending invite do platform.team_invites (token, email,
 *      promoter_id, role, expires_at). Token je single-use (accepted_at /
 *      revoked_at guard) a expirující (7 dní).
 *   3. Odešle se e-mail s accept linkem na /team/accept?token=…
 *   4. Adresát otevře link → /api/team/accept ho buď přihlásí (existující
 *      účet), nebo nechá zaregistrovat (heslo + jméno), pak přidá do
 *      platform.promoter_members a invite označí jako accepted.
 */

import { randomBytes } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsPromoter, runAsActivePromoterOwner } from '@/lib/admin-auth';
import { z } from 'zod';


const INVITE_TTL_HOURS = 168; // 7 dní

interface MemberRow {
  user_id: string;
  email: string;
  name: string | null;
  role: 'owner' | 'admin' | 'staff';
  status: string;
  created_at: string;
}

interface InviteRow {
  id: string;
  email: string;
  role: string;
  expires_at: string;
  created_at: string;
}

export async function GET(req: NextRequest): Promise<Response> {
  return runAsPromoter(req, async (promoter) => {
  const [members, invites] = await Promise.all([
    db().query<MemberRow>(
      `SELECT m.user_id, u.email, u.name, m.role, m.status, m.created_at
       FROM platform.promoter_members m
       JOIN identity.users u ON u.id = m.user_id
       WHERE m.promoter_id = $1
       ORDER BY
         CASE m.role
           WHEN 'owner' THEN 1
           WHEN 'admin' THEN 2
           WHEN 'staff' THEN 3
           ELSE 4
         END, u.email`,
      [promoter.promoterId],
    ),
    db().query<InviteRow>(
      `SELECT id, email, role::text AS role, expires_at, created_at
       FROM platform.team_invites
       WHERE promoter_id = $1
         AND accepted_at IS NULL AND revoked_at IS NULL
         AND expires_at > NOW()
       ORDER BY created_at DESC`,
      [promoter.promoterId],
    ),
  ]);

  return NextResponse.json({
    currentUserId: promoter.userId,
    currentRole: promoter.role,
    members: members.rows.map((m) => ({
      userId: m.user_id,
      email: m.email,
      name: m.name,
      role: m.role,
      status: m.status,
      createdAt: m.created_at,
    })),
    pendingInvites: invites.rows.map((i) => ({
      id: i.id,
      email: i.email,
      role: i.role,
      expiresAt: i.expires_at,
      createdAt: i.created_at,
    })),
  });

  });
}

const inviteSchema = z.object({
  email: z.string().email().max(200),
  role: z.enum(['admin', 'staff', 'box_office']), // kolo 12: + pokladna
});

export async function POST(req: NextRequest): Promise<Response> {
  return runAsActivePromoterOwner(req, async (promoter) => {
  const body: unknown = await req.json().catch(() => ({}));
  const parsed = inviteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.issues },
      { status: 422 },
    );
  }
  const email = parsed.data.email.toLowerCase();

  // Už členem? (RLS scope-uje na promoter_id přes context)
  const existing = await db().query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM platform.promoter_members pm
     JOIN identity.users u ON u.id = pm.user_id
     WHERE pm.promoter_id = $1 AND LOWER(u.email) = $2`,
    [promoter.promoterId, email],
  );
  if (Number(existing.rows[0]?.count ?? 0) > 0) {
    return NextResponse.json(
      { error: 'ALREADY_MEMBER', message: 'Tento e-mail už je členem týmu.' },
      { status: 409 },
    );
  }

  // Aktivní pending invite na stejný e-mail?
  const pending = await db().query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM platform.team_invites
     WHERE promoter_id = $1 AND LOWER(email) = $2
       AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > NOW()`,
    [promoter.promoterId, email],
  );
  if (Number(pending.rows[0]?.count ?? 0) > 0) {
    return NextResponse.json(
      { error: 'INVITE_PENDING', message: 'Pozvánka už čeká na přijetí.' },
      { status: 409 },
    );
  }

  // Náhodný single-use token (32 B → 43 znaků base64url). Unique constraint
  // na team_invites.token zaručuje neopakovatelnost.
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
      email,
      parsed.data.role,
      token,
      expiresAt.toISOString(),
    ],
  );

  // Accept link + e-mail přes interní webhook (sdílí mailer s /api/admin/team)
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  const inviteUrl = `${baseUrl}/team/accept?token=${token}`;
  void fetch(`${baseUrl}/api/internal/team-invite-email`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-internal-token': process.env.INTERNAL_SERVICE_TOKEN ?? '',
    },
    body: JSON.stringify({
      toEmail: email,
      promoterName: promoter.promoterName,
      role: parsed.data.role,
      inviteUrl,
    }),
  }).catch((err) => console.error('[staff invite email]', err));

  return NextResponse.json(
    {
      ok: true,
      id: r.rows[0].id,
      email,
      role: parsed.data.role,
      expiresAt: expiresAt.toISOString(),
    },
    { status: 201 },
  );

  });
}
