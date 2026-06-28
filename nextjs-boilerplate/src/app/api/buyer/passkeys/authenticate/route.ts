/**
 * Passkey authentication — full @simplewebauthn/server implementation.
 *
 * GET  — generateAuthenticationOptions (discoverable / email hint)
 * POST — verifyAuthenticationResponse + update counter + issue Tixly JWT
 *
 * Bezpečnost:
 * - Assertion signature ověřena kryptograficky (ECDSA/RSA přes WebCrypto)
 * - Counter monotonically increasing — detekce klonovacího útoku
 * - Fail-closed: jakákoli chyba → 400/401, nikdy neznamená přihlášení
 */
import { NextRequest, NextResponse } from 'next/server';
import {
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  type VerifyAuthenticationResponseOpts,
} from '@simplewebauthn/server';
import type {
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
} from '@simplewebauthn/types';
import { z } from 'zod';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';
import {
  signAccessToken,
  signRefreshToken,
  setAuthCookies,
  getUserRoles,
} from '@/lib/auth';
import { consumeChallenge } from '@/lib/webauthn/challenges';

export const dynamic = 'force-dynamic';

function getRpConfig() {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  const origin = appUrl.replace(/\/$/, '');
  const rpID   = new URL(origin).hostname;
  return { origin, rpID };
}

// ── GET: vygeneruj authentication challenge ───────────────────────────────────
export async function GET(req: NextRequest): Promise<Response> {
  return runWithServiceContext(async () => {
    const { rpID } = getRpConfig();
    const emailParam = req.nextUrl.searchParams.get('email');

    let userId: string | null = null;
    let allowCredentials: {
      id: Buffer;
      type: 'public-key';
      transports?: AuthenticatorTransportFuture[];
    }[] = [];

    if (emailParam) {
      const u = await db().query<{ id: string }>(
        `SELECT id FROM identity.users WHERE LOWER(email) = LOWER($1) AND deleted_at IS NULL LIMIT 1`,
        [emailParam],
      );
      if (u.rows.length > 0) {
        userId = u.rows[0].id;
        const creds = await db().query<{ credential_id: Buffer; transports: string[] | null }>(
          `SELECT credential_id, transports FROM identity.webauthn_credentials WHERE user_id = $1`,
          [userId],
        );
        allowCredentials = creds.rows.map((c) => ({
          id:         c.credential_id,
          type:       'public-key' as const,
          transports: (c.transports ?? []) as AuthenticatorTransportFuture[],
        }));
      }
    }

    const options = await generateAuthenticationOptions({
      rpID,
      allowCredentials,
      userVerification: 'preferred',
    });

    // Ulož challenge
    const challengeBuf = Buffer.from(options.challenge, 'base64url');
    const challengeRow = await db().query<{ id: string }>(
      `INSERT INTO identity.webauthn_challenges (user_id, challenge, challenge_type)
       VALUES ($1, $2, 'authentication')
       RETURNING id`,
      [userId, challengeBuf],
    );

    return NextResponse.json({
      challengeId:      challengeRow.rows[0].id,
      publicKeyOptions: options,
    });
  });
}

// ── POST: ověř assertion a vydej JWT ─────────────────────────────────────────
const postSchema = z.object({
  challengeId: z.string().uuid(),
  credential:  z.record(z.unknown()),
});

export async function POST(req: NextRequest): Promise<Response> {
  return runWithServiceContext(async () => {
    const body   = await req.json().catch(() => null);
    const parsed = postSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'INVALID_BODY' }, { status: 422 });
    }

    const challengeRow = await consumeChallenge(parsed.data.challengeId);
    if (!challengeRow || challengeRow.challenge_type !== 'authentication') {
      return NextResponse.json({ error: 'INVALID_OR_EXPIRED_CHALLENGE' }, { status: 410 });
    }

    const { origin, rpID }  = getRpConfig();
    const expectedChallenge = (challengeRow.challenge as Buffer).toString('base64url');

    // Zjisti credential_id z odpovědi klienta
    const credentialId = (parsed.data.credential as { id?: string }).id;
    if (!credentialId) {
      return NextResponse.json({ error: 'MISSING_CREDENTIAL_ID' }, { status: 400 });
    }

    const credIdBuf = Buffer.from(credentialId, 'base64url');

    // Načti uloženou credential + user
    const storedCred = await db().query<{
      id:                 string;
      user_id:            string;
      public_key:         Buffer;
      counter:            string;
      transports:         string[] | null;
      is_backup_eligible: boolean;
      is_backup_state:    boolean;
    }>(
      `SELECT id, user_id, public_key, counter, transports, is_backup_eligible, is_backup_state
       FROM identity.webauthn_credentials
       WHERE credential_id = $1`,
      [credIdBuf],
    );

    if (storedCred.rows.length === 0) {
      return NextResponse.json({ error: 'UNKNOWN_CREDENTIAL' }, { status: 404 });
    }

    const cred = storedCred.rows[0];

    let verification: Awaited<ReturnType<typeof verifyAuthenticationResponse>>;
    try {
      const opts: VerifyAuthenticationResponseOpts = {
        response:                parsed.data.credential as unknown as AuthenticationResponseJSON,
        expectedChallenge,
        expectedOrigin:          origin,
        expectedRPID:            rpID,
        requireUserVerification: false,
        authenticator: {
          credentialID:        credIdBuf,
          credentialPublicKey: new Uint8Array(cred.public_key),
          counter:             Number(cred.counter),
          transports:          (cred.transports ?? []) as AuthenticatorTransportFuture[],
        },
      };
      verification = await verifyAuthenticationResponse(opts);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'verification failed';
      return NextResponse.json({ error: 'VERIFICATION_FAILED', detail: msg }, { status: 401 });
    }

    if (!verification.verified) {
      return NextResponse.json({ error: 'NOT_VERIFIED' }, { status: 401 });
    }

    const { newCounter } = verification.authenticationInfo;

    // Atomicky aktualizuj counter (detekce klonu: newCounter musí být > counter)
    const updated = await db().query(
      `UPDATE identity.webauthn_credentials
          SET counter = $1, last_used_at = NOW()
        WHERE id = $2 AND counter < $1`,
      [newCounter, cred.id],
    );

    if ((updated.rowCount ?? 0) === 0 && newCounter > 0) {
      // counter se nezměnil nahoru = klonovaný authenticator
      return NextResponse.json({ error: 'COUNTER_REPLAY' }, { status: 401 });
    }

    // Načti user pro JWT
    const userRow = await db().query<{ id: string; email: string; name: string }>(
      `SELECT id, email, COALESCE(name, email) AS name
       FROM identity.users WHERE id = $1 AND deleted_at IS NULL`,
      [cred.user_id],
    );
    if (userRow.rows.length === 0) {
      return NextResponse.json({ error: 'USER_NOT_FOUND' }, { status: 404 });
    }
    const user  = userRow.rows[0];
    const roles = await getUserRoles(user.id);

    const [accessToken, refreshToken] = await Promise.all([
      signAccessToken(user, roles),
      signRefreshToken(user),
    ]);

    const res = NextResponse.json({ ok: true, user, roles, accessToken });
    setAuthCookies(res, accessToken, refreshToken);
    return res;
  });
}
