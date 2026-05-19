import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  db,
  hashPassword,
  signAccessToken,
  signRefreshToken,
  setAuthCookies,
  getUserRoles,
} from '@/lib/auth';

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  name: z.string().min(1).max(120),
  companyName: z.string().min(2).max(200),
  slug: z.string().regex(/^[a-z0-9-]+$/, 'Pouze a-z, 0-9 a pomlčky'),
});

export async function POST(request: NextRequest): Promise<Response> {
  const body: unknown = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.issues },
      { status: 422 },
    );
  }
  const { email, password, name, companyName, slug } = parsed.data;
  const hash = await hashPassword(password);
  const client = await db().connect();

  try {
    await client.query('BEGIN');

    const userRes = await client.query<{ id: string }>(
      `INSERT INTO identity.users (email, name, password_hash, gdpr_consent_at, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW(), NOW())
       RETURNING id`,
      [email.toLowerCase(), name, hash],
    );
    const userId = userRes.rows[0].id;

    const promoterRes = await client.query<{ id: string }>(
      `INSERT INTO platform.promoters (name, email, contact_email, slug, status, locale, created_at, updated_at)
       VALUES ($1, $2, $2, $3, 'pending', 'cs', NOW(), NOW())
       RETURNING id`,
      [companyName, email.toLowerCase(), slug],
    );
    const promoterId = promoterRes.rows[0].id;

    await client.query(
      `INSERT INTO platform.promoter_members (promoter_id, user_id, role, created_at, updated_at)
       VALUES ($1, $2, 'owner'::platform.member_role, NOW(), NOW())`,
      [promoterId, userId],
    );

    await client.query('COMMIT');

    const user = { id: userId, email, name };
    const roles = await getUserRoles(userId);
    const accessToken = await signAccessToken(user, roles);
    const refreshToken = await signRefreshToken(user);

    const res = NextResponse.json({ user, roles, promoterId, accessToken });
    setAuthCookies(res, accessToken, refreshToken);
    return res;
  } catch (err) {
    await client.query('ROLLBACK');
    if ((err as { code?: string }).code === '23505') {
      return NextResponse.json({ error: 'Email nebo slug už existuje' }, { status: 409 });
    }
    console.error('[register-promoter]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  } finally {
    client.release();
  }
}
