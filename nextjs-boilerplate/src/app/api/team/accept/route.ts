/**
 * POST /api/team/accept
 *
 * Body: { token, password? (pokud nový user), name? }
 *
 * Flow:
 *   1. Najdi invite podle tokenu (status 'pending', not expired, not revoked)
 *   2. Pokud user (s emailem invite) existuje → connect membership
 *   3. Pokud neexistuje → vyžaduje password+name → vytvoří user, connect membership
 *   4. Mark invite as accepted, vrátí JWT pro nového/existujícího usera
 */

import { NextRequest, NextResponse } from 'next/server';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';
import { z } from 'zod';
import { hashPassword, signAccessToken, getUserRoles } from '@/lib/auth';


const schema = z.object({
  token: z.string().min(20).max(200),
  password: z.string().min(8).max(200).optional(),
  name: z.string().min(1).max(120).optional(),
});

export async function POST(req: NextRequest): Promise<Response> {
  return runWithServiceContext(async () => {

  const body: unknown = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed' }, { status: 422 });
  }

  const client = await db().connect();
  try {
    await client.query('BEGIN');
    const inv = await client.query<{
      id: string;
      promoter_id: string;
      email: string;
      role: string;
    }>(
      `SELECT id, promoter_id, email, role::text AS role
       FROM platform.team_invites
       WHERE token = $1 AND accepted_at IS NULL AND revoked_at IS NULL
         AND expires_at > NOW()
       FOR UPDATE`,
      [parsed.data.token],
    );
    if (inv.rows.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: 'INVITE_INVALID', message: 'Invite je neplatný nebo vypršel.' },
        { status: 410 },
      );
    }
    const invite = inv.rows[0];

    // Find existing user
    const existingUser = await client.query<{ id: string }>(
      `SELECT id FROM identity.users WHERE LOWER(email) = LOWER($1) AND anonymized_at IS NULL`,
      [invite.email],
    );
    let userId: string;
    if (existingUser.rows.length > 0) {
      userId = existingUser.rows[0].id;
    } else {
      if (!parsed.data.password || !parsed.data.name) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          {
            error: 'NEW_USER_REQUIRES_PASSWORD_NAME',
            message: 'Pro tento e-mail neexistuje účet — pošli password + name.',
          },
          { status: 422 },
        );
      }
      const hash = await hashPassword(parsed.data.password);
      const ins = await client.query<{ id: string }>(
        `INSERT INTO identity.users
           (email, name, password_hash, gdpr_consent_at, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW(), NOW())
         RETURNING id`,
        [invite.email.toLowerCase(), parsed.data.name, hash],
      );
      userId = ins.rows[0].id;
    }

    // Membership upsert
    await client.query(
      `INSERT INTO platform.promoter_members (promoter_id, user_id, role, status)
       VALUES ($1, $2, $3::platform.member_role, 'active')
       ON CONFLICT (promoter_id, user_id) DO UPDATE
         SET role = EXCLUDED.role, status = 'active', updated_at = NOW()`,
      [invite.promoter_id, userId, invite.role],
    );

    await client.query(
      `UPDATE platform.team_invites
       SET accepted_at = NOW(), accepted_by_user_id = $2
       WHERE id = $1`,
      [invite.id, userId],
    );

    await client.query('COMMIT');

    const userRow = await db().query<{ name: string | null }>(
      `SELECT name FROM identity.users WHERE id = $1`,
      [userId],
    );
    const roles = await getUserRoles(userId);
    const accessToken = await signAccessToken(
      { id: userId, email: invite.email, name: userRow.rows[0]?.name ?? '' },
      roles,
    );
    return NextResponse.json({
      ok: true,
      accessToken,
      promoterId: invite.promoter_id,
      role: invite.role,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[team accept]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  } finally {
    client.release();
  }

  });
}
