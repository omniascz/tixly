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
import { checkAres, computeInitialRiskScore, type AresCheckResult } from '@/lib/compliance/ares';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit/per-tenant';
import { clientIp } from '@/lib/security/client-ip';

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  // Volitelné — registrace stačí e-mail + heslo, zbytek se doplní z adminu.
  name: z.string().min(1).max(120).optional(),
  companyName: z.string().min(2).max(200).optional(),
  slug: z
    .string()
    .regex(/^[a-z0-9-]+$/, 'Pouze a-z, 0-9 a pomlčky')
    .optional(),
  ico: z.string().regex(/^\d{8}$/, 'IČO musí mít 8 číslic').optional(),
});

/** Odvodí slug z e-mailu — celý e-mail je unikátní, takže i slug bude. */
function slugFromEmail(email: string): string {
  return email
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export async function POST(request: NextRequest): Promise<Response> {
  // Anti-spam: max 5 registrací promotéra / hod per IP.
  const ip = clientIp(request);
  const limited = rateLimitResponse(
    await checkRateLimit(`register-promoter:${ip}`, { limit: 5, windowMs: 3_600_000 }),
    'register-promoter',
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
  const { email, password, ico } = parsed.data;
  // Defaulty z e-mailu — jméno/organizace/slug se doplní později z adminu.
  const emailLocal = email.toLowerCase().split('@')[0];
  const name = parsed.data.name ?? emailLocal;
  const companyName = parsed.data.companyName ?? emailLocal;
  const slug = parsed.data.slug ?? slugFromEmail(email);
  const hash = await hashPassword(password);

  // ARES check (best-effort, non-blocking) — P0 risk mitigace
  // Pokud IČO valid + active → low risk score. Pokud invalid → high risk.
  // Kolo 7: výpadek / timeout ARES (outcome 'unavailable') NENÍ neplatné IČO — pořadatel jde do
  // ručního ověření (manual_verification_required), ares_ico_valid zůstane neznámé (NULL).
  const aresResult: AresCheckResult = ico
    ? await checkAres(ico)
    : { valid: false, active: false, outcome: 'not_provided', error: 'NO_ICO_PROVIDED' };
  const riskScore = computeInitialRiskScore(aresResult);
  const aresUnavailable = aresResult.outcome === 'unavailable';

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
          ares_check_status, manual_verification_required,
          risk_score, pre_review_volume_cap_halire,
          created_at, updated_at)
       VALUES ($1, $2, $2, $3, 'pending', 'cs',
               $4, NOW(), $5, $6, $7::jsonb,
               $9, $10,
               $8, 10000000,
               NOW(), NOW())
       RETURNING id`,
      [
        companyName,
        email.toLowerCase(),
        slug,
        ico ?? null,
        aresUnavailable ? null : aresResult.valid,
        aresUnavailable ? null : aresResult.active,
        aresResult.raw ? JSON.stringify(aresResult.raw) : null,
        riskScore,
        aresResult.outcome === 'invalid' ? 'not_found' : aresResult.outcome,
        aresUnavailable,
      ],
    );
    const promoterId = promoterRes.rows[0].id;

    await client.query(
      `INSERT INTO platform.promoter_members (promoter_id, user_id, role, created_at, updated_at)
       VALUES ($1, $2, 'owner'::platform.member_role, NOW(), NOW())`,
      [promoterId, userId],
    );

    await client.query(
      `INSERT INTO platform.promoter_onboarding (promoter_id) VALUES ($1) ON CONFLICT (promoter_id) DO NOTHING`,
      [promoterId],
    );

    await client.query('COMMIT');

    const user = { id: userId, email, name };
    const roles = await getUserRoles(userId);
    const accessToken = await signAccessToken(user, roles);
    const refreshToken = await signRefreshToken(user);

    const res = NextResponse.json({ user, roles, promoterId, accessToken, redirectTo: '/admin/onboarding' });
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
