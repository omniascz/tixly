/**
 * POST /api/consent — log uživatelské consent volby (GDPR Art. 7 burden of proof).
 *
 * Body: { essential, analytics, marketing, source }
 * Auth: optional — pokud session cookie, propojí s user_id
 *
 * IP je hashována SHA-256 (data minimisation). Audit log retention 90 dní.
 */
import { NextRequest, NextResponse } from 'next/server';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';
import { createHash } from 'crypto';
import { resolveSecret } from '@/lib/security/secrets';
import { clientIp } from '@/lib/security/client-ip';
import { z } from 'zod';

const bodySchema = z.object({
  essential: z.boolean().default(true),
  analytics: z.boolean(),
  marketing: z.boolean(),
  source: z.enum(['banner', 'settings-page', 'reset', 'api']).default('banner'),
  sessionId: z.string().max(64).optional(),
});


function hashIp(ip: string): string {
  // Salt nesmí být v produkci veřejně známý literal — jinak je IPv4 hash
  // triviálně reverzibilní (brute-force celého prostoru) a pseudonymizace padá.
  const salt = resolveSecret(
    process.env.IP_HASH_SALT,
    'IP_HASH_SALT',
    'tixly-default-salt-rotate-quarterly',
  );
  return createHash('sha256').update(`${salt}:${ip}`).digest('hex').slice(0, 32);
}

export async function POST(req: NextRequest): Promise<Response> {
  return runWithServiceContext(async () => {

  let body: z.infer<typeof bodySchema>;
  try {
    const json: unknown = await req.json();
    body = bodySchema.parse(json);
  } catch {
    return NextResponse.json({ error: 'INVALID_BODY' }, { status: 400 });
  }

  const userId = req.headers.get('x-user-id')?.trim() || null;
  const ip = clientIp(req);
  const ipHash = ip && ip !== 'unknown' ? hashIp(ip) : null;
  const ua = req.headers.get('user-agent')?.slice(0, 500) ?? null;

  try {
    await db().query(
      `INSERT INTO compliance.cookie_consent_log
        (user_id, session_id, essential, analytics, marketing, ip_hash, user_agent, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [userId, body.sessionId ?? null, body.essential, body.analytics, body.marketing, ipHash, ua, body.source],
    );
  } catch (err) {
    // Tabulka může neexistovat (migration not applied) — log jen do console, neselhej UX
    console.warn('[consent-log] insert failed:', err);
  }

  return NextResponse.json({ ok: true });

  });
}

export async function GET(req: NextRequest): Promise<Response> {
  return runWithServiceContext(async () => {

  // Vrátí historie consent pro přihlášeného uživatele (data subject access right)
  const userId = req.headers.get('x-user-id')?.trim();
  if (!userId) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }
  try {
    const r = await db().query(
      `SELECT decided_at, essential, analytics, marketing, source
         FROM compliance.cookie_consent_log
        WHERE user_id = $1
        ORDER BY decided_at DESC
        LIMIT 50`,
      [userId],
    );
    return NextResponse.json({ history: r.rows });
  } catch {
    return NextResponse.json({ history: [] });
  }

  });
}
