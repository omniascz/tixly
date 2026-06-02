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
import { checkAres, computeInitialRiskScore } from '@/lib/compliance/ares';

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  name: z.string().min(1).max(120),
  companyName: z.string().min(2).max(200),
  slug: z.string().regex(/^[a-z0-9-]+$/, 'Pouze a-z, 0-9 a pomlčky'),
  ico: z.string().regex(/^\d{8}$/, 'IČO musí mít 8 číslic').optional(),
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
  const { email, password, name, companyName, slug, ico } = parsed.data;
  const hash = await hashPassword(password);

  // ARES check (best-effort, non-blocking) — P0 risk mitigace
  // Pokud IČO valid + active → low risk score. Pokud invalid → high risk.
  const aresResult = ico
    ? await checkAres(ico)
    : { valid: false, active: false, error: 'NO_ICO_PROVIDED' };
  const riskScore = computeInitialRiskScore(aresResult);

  // Pre-context (vytvoření usera+promotéra+membera v transakci) → service.
  return runWithServiceContext(async () => {
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
      `INSERT INTO platform.promoters
         (name, email, contact_email, slug, status, locale,
          company_ico, ares_checked_at, ares_ico_valid, ares_company_active, ares_raw_response,
          risk_score, pre_review_volume_cap_halire,
          created_at, updated_at)
       VALUES ($1, $2, $2, $3, 'pending', 'cs',
               $4, NOW(), $5, $6, $7::jsonb,
               $8, 10000000,
               NOW(), NOW())
       RETURNING id`,
      [
        companyName,
        email.toLowerCase(),
        slug,
        ico ?? null,
        aresResult.valid,
        aresResult.active,
        aresResult.raw ? JSON.stringify(aresResult.raw) : null,
        riskScore,
      ],
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
  });
}
