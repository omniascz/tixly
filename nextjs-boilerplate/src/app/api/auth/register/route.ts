import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  hashPassword,
  signAccessToken,
  signRefreshToken,
  setAuthCookies,
  getUserRoles,
} from '@/lib/auth';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit/per-tenant';

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  name: z.string().min(1).max(120),
});

export async function POST(request: NextRequest): Promise<Response> {
  // Anti-spam: max 10 registrací kupujícího / hod per IP.
  const ip = (request.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown';
  const limited = rateLimitResponse(
    await checkRateLimit(`register:${ip}`, { limit: 10, windowMs: 3_600_000 }),
    'register',
  );
  if (limited) return limited;

  const body: unknown = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.issues },
      { status: 422 },
    );
  }
  const { email, password, name } = parsed.data;
  const hash = await hashPassword(password);

  try {
    // Pre-context (vytvoření usera) → service.
    const result = await runWithServiceContext(() =>
      db().query<{ id: string }>(
        `INSERT INTO identity.users (email, name, password_hash, gdpr_consent_at, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW(), NOW())
         RETURNING id`,
        [email.toLowerCase(), name, hash],
      ),
    );
    const userId = result.rows[0].id;
    const user = { id: userId, email, name };
    const roles = await getUserRoles(userId);
    const accessToken = await signAccessToken(user, roles);
    const refreshToken = await signRefreshToken(user);

    const res = NextResponse.json({ user, roles, accessToken });
    setAuthCookies(res, accessToken, refreshToken);
    return res;
  } catch (err) {
    if ((err as { code?: string }).code === '23505') {
      return NextResponse.json({ error: 'Email already registered' }, { status: 409 });
    }
    console.error('[register]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
