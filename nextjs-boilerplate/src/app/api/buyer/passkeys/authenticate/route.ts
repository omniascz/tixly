/**
 * POST /api/buyer/passkeys/authenticate
 *
 * GET  — vrátí authentication challenge + allowCredentials seznam.
 * POST — verifikuje signed assertion, vrátí JWT (re-uses existing session JWT flow).
 *
 * SKELETON — production vyžaduje @simplewebauthn/server pro assertion signature
 * verification proti uloženému public_key.
 */
import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { z } from 'zod';
import { createChallenge, consumeChallenge } from '@/lib/webauthn/challenges';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

const verifySchema = z.object({
  challengeId: z.string().uuid(),
  credentialId: z.string().min(1).max(1024),
  // signature, authenticatorData, clientDataJSON — produkce by je verifikovala
  signature: z.string().min(1).max(4096).optional(),
  authenticatorData: z.string().min(1).max(4096).optional(),
  clientDataJSON: z.string().min(1).max(4096).optional(),
});

export async function GET(req: NextRequest): Promise<Response> {
  // Discoverable credential flow — user nemusí dát email, authenticator nabídne credentials.
  const emailParam = new URL(req.url).searchParams.get('email');
  let userId: string | null = null;
  let allowCredentials: { id: string; type: 'public-key'; transports?: string[] }[] = [];

  if (emailParam) {
    const u = await db().query<{ id: string }>(
      `SELECT id FROM identity.users WHERE LOWER(email) = LOWER($1) LIMIT 1`,
      [emailParam],
    );
    if (u.rows.length > 0) {
      userId = u.rows[0].id;
      const creds = await db().query<{ credential_id: Buffer; transports: string[] | null }>(
        `SELECT credential_id, transports FROM identity.webauthn_credentials WHERE user_id = $1`,
        [userId],
      );
      allowCredentials = creds.rows.map((c) => ({
        id: c.credential_id.toString('base64url'),
        type: 'public-key' as const,
        transports: c.transports ?? undefined,
      }));
    }
  }

  const { id, challenge } = await createChallenge(userId, 'authentication');

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  const rpId = new URL(appUrl).hostname;

  return NextResponse.json({
    challengeId: id,
    publicKeyOptions: {
      challenge,
      rpId,
      allowCredentials,
      userVerification: 'preferred',
      timeout: 60_000,
    },
  });
}

export async function POST(req: NextRequest): Promise<Response> {
  const body: unknown = await req.json().catch(() => ({}));
  const parsed = verifySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'INVALID_BODY' }, { status: 422 });
  }

  const challenge = await consumeChallenge(parsed.data.challengeId);
  if (!challenge || challenge.challenge_type !== 'authentication') {
    return NextResponse.json({ error: 'INVALID_OR_EXPIRED_CHALLENGE' }, { status: 410 });
  }

  // SKELETON: production by tady ověřil signature
  const credIdBuf = Buffer.from(parsed.data.credentialId, 'base64url');
  const cred = await db().query<{ id: string; user_id: string; counter: string }>(
    `UPDATE identity.webauthn_credentials
        SET counter = counter + 1, last_used_at = now()
      WHERE credential_id = $1
      RETURNING id, user_id, counter::text`,
    [credIdBuf],
  );

  if (cred.rows.length === 0) {
    return NextResponse.json({ error: 'UNKNOWN_CREDENTIAL' }, { status: 404 });
  }

  // V production: tady by se vrátil session JWT (přihlášení).
  return NextResponse.json({
    authenticated: true,
    userId: cred.rows[0].user_id,
    counter: Number(cred.rows[0].counter),
    note: 'SKELETON — assertion signature není verifikována. Pro produkci přidej @simplewebauthn/server.',
  });
}
