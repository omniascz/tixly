/**
 * POST /api/buyer/passkeys/register
 *
 * Step 1: GET-style preflight — vrátí challenge + relyingParty + user info.
 * Step 2: POST s { challengeId, credential: PublicKeyCredentialJSON } → uloží do DB.
 *
 * Skeleton — pro production použij @simplewebauthn/server pro verifikaci attestation.
 * Tady jen ukládáme raw credential.id + publicKey (klient je posílá v base64url).
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
  publicKey: z.string().min(1).max(4096),
  deviceName: z.string().max(100).optional(),
  transports: z.array(z.string().max(20)).max(5).optional(),
  aaguid: z.string().uuid().optional(),
});

export async function GET(req: NextRequest): Promise<Response> {
  const userId = req.headers.get('x-user-id');
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const user = await db().query<{ email: string; name: string | null }>(
    `SELECT email, name FROM identity.users WHERE id = $1`,
    [userId],
  );
  if (user.rows.length === 0) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }

  const { id, challenge } = await createChallenge(userId, 'registration');

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  const rpId = new URL(appUrl).hostname;

  return NextResponse.json({
    challengeId: id,
    publicKeyOptions: {
      challenge,
      rp: { id: rpId, name: 'Tixly' },
      user: {
        id: Buffer.from(userId).toString('base64url'),
        name: user.rows[0].email,
        displayName: user.rows[0].name ?? user.rows[0].email,
      },
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 }, // ES256
        { type: 'public-key', alg: -257 }, // RS256
      ],
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'preferred',
      },
      timeout: 60_000,
      attestation: 'none',
    },
  });
}

export async function POST(req: NextRequest): Promise<Response> {
  const userId = req.headers.get('x-user-id');
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body: unknown = await req.json().catch(() => ({}));
  const parsed = verifySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'INVALID_BODY' }, { status: 422 });
  }

  const challenge = await consumeChallenge(parsed.data.challengeId);
  if (!challenge || challenge.challenge_type !== 'registration') {
    return NextResponse.json({ error: 'INVALID_OR_EXPIRED_CHALLENGE' }, { status: 410 });
  }

  // SKELETON: production by tady ověřil attestation a counter
  const credentialIdBuf = Buffer.from(parsed.data.credentialId, 'base64url');
  const publicKeyBuf = Buffer.from(parsed.data.publicKey, 'base64url');

  try {
    const r = await db().query<{ id: string }>(
      `INSERT INTO identity.webauthn_credentials
         (user_id, credential_id, public_key, device_name, transports, aaguid)
       VALUES ($1, $2, $3, $4, $5, $6::uuid)
       RETURNING id`,
      [
        userId, credentialIdBuf, publicKeyBuf,
        parsed.data.deviceName ?? null,
        parsed.data.transports ?? null,
        parsed.data.aaguid ?? null,
      ],
    );
    return NextResponse.json({ registered: true, credentialId: r.rows[0].id }, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown';
    if (msg.includes('duplicate')) {
      return NextResponse.json({ error: 'ALREADY_REGISTERED' }, { status: 409 });
    }
    return NextResponse.json({ error: 'DB_ERROR', message: msg }, { status: 500 });
  }
}
