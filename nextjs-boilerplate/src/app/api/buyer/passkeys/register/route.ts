/**
 * Passkey registration — full @simplewebauthn/server implementation.
 *
 * GET  — generateRegistrationOptions + store challenge
 * POST — verifyRegistrationResponse + uložit credential do DB
 *
 * Bezpečnost:
 * - Challenge je jednorázová (consumeChallenge = atomický UPDATE + returning)
 * - counter, credentialDeviceType, backedUp uloženy pro audit
 * - duplikátní credential_id → 409 (ON CONFLICT)
 */
import { NextRequest, NextResponse } from 'next/server';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  type VerifyRegistrationResponseOpts,
} from '@simplewebauthn/server';
import type {
  RegistrationResponseJSON,
  AuthenticatorTransportFuture,
} from '@simplewebauthn/types';
import { z } from 'zod';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';
import { runAsUser } from '@/lib/auth';
import { consumeChallenge } from '@/lib/webauthn/challenges';

export const dynamic = 'force-dynamic';

function getRpConfig() {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  const origin = appUrl.replace(/\/$/, '');
  const rpID   = new URL(origin).hostname;
  return { origin, rpID };
}

// ── GET: vygeneruj options pro registraci ─────────────────────────────────────
export async function GET(req: NextRequest): Promise<Response> {
  return runAsUser(req, async (userId) => {
    const { origin, rpID } = getRpConfig();

    const userRow = await runWithServiceContext(() =>
      db().query<{ email: string; name: string | null }>(
        `SELECT email, name FROM identity.users WHERE id = $1`,
        [userId],
      ),
    );
    if (userRow.rows.length === 0) {
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    }
    const u = userRow.rows[0];

    // Existující credentials pro excludeCredentials
    const existing = await runWithServiceContext(() =>
      db().query<{ credential_id: Buffer; transports: string[] | null }>(
        `SELECT credential_id, transports FROM identity.webauthn_credentials WHERE user_id = $1`,
        [userId],
      ),
    );

    const options = await generateRegistrationOptions({
      rpName:             'Tixly',
      rpID,
      userID:             userId,
      userName:           u.email,
      userDisplayName:    u.name ?? u.email,
      attestationType:    'none',
      excludeCredentials: existing.rows.map((c) => ({
        id:         c.credential_id,
        type:       'public-key' as const,
        transports: (c.transports ?? []) as AuthenticatorTransportFuture[],
      })),
      authenticatorSelection: {
        residentKey:      'preferred',
        userVerification: 'preferred',
      },
      supportedAlgorithmIDs: [-7, -257],
    });

    // Ulož challenge (options.challenge = base64url string)
    const challengeBuf = Buffer.from(options.challenge, 'base64url');
    const challengeRow = await runWithServiceContext(() =>
      db().query<{ id: string }>(
        `INSERT INTO identity.webauthn_challenges (user_id, challenge, challenge_type)
         VALUES ($1, $2, 'registration')
         RETURNING id`,
        [userId, challengeBuf],
      ),
    );

    return NextResponse.json({
      challengeId:      challengeRow.rows[0].id,
      expectedOrigin:   origin,
      expectedRpID:     rpID,
      publicKeyOptions: options,
    });
  });
}

// ── POST: ověř attestation a ulož credential ──────────────────────────────────
const postSchema = z.object({
  challengeId: z.string().uuid(),
  credential:  z.record(z.unknown()),
  deviceName:  z.string().max(100).optional(),
});

export async function POST(req: NextRequest): Promise<Response> {
  return runAsUser(req, async (userId) => {
    const body   = await req.json().catch(() => null);
    const parsed = postSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'INVALID_BODY' }, { status: 422 });
    }

    const challengeRow = await consumeChallenge(parsed.data.challengeId);
    if (!challengeRow || challengeRow.challenge_type !== 'registration') {
      return NextResponse.json({ error: 'INVALID_OR_EXPIRED_CHALLENGE' }, { status: 410 });
    }

    const { origin, rpID }  = getRpConfig();
    const expectedChallenge = (challengeRow.challenge as Buffer).toString('base64url');

    let verification: Awaited<ReturnType<typeof verifyRegistrationResponse>>;
    try {
      const opts: VerifyRegistrationResponseOpts = {
        response:                parsed.data.credential as unknown as RegistrationResponseJSON,
        expectedChallenge,
        expectedOrigin:          origin,
        expectedRPID:            rpID,
        requireUserVerification: false,
      };
      verification = await verifyRegistrationResponse(opts);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'verification failed';
      return NextResponse.json({ error: 'VERIFICATION_FAILED', detail: msg }, { status: 400 });
    }

    if (!verification.verified || !verification.registrationInfo) {
      return NextResponse.json({ error: 'NOT_VERIFIED' }, { status: 400 });
    }

    const {
      credentialID,
      credentialPublicKey,
      counter,
      credentialDeviceType,
      credentialBackedUp,
    } = verification.registrationInfo;

    const transports =
      (parsed.data.credential as { response?: { transports?: string[] } }).response?.transports
      ?? null;

    try {
      const row = await runWithServiceContext(() =>
        db().query<{ id: string }>(
          `INSERT INTO identity.webauthn_credentials
             (user_id, credential_id, public_key, counter,
              device_name, transports, is_backup_eligible, is_backup_state)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING id`,
          [
            userId,
            Buffer.from(credentialID),
            Buffer.from(credentialPublicKey),
            counter,
            parsed.data.deviceName ?? null,
            transports,
            credentialDeviceType === 'multiDevice',
            credentialBackedUp,
          ],
        ),
      );
      return NextResponse.json({ ok: true, passkeyId: row.rows[0].id }, { status: 201 });
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (msg.includes('unique') || msg.includes('duplicate')) {
        return NextResponse.json({ error: 'CREDENTIAL_ALREADY_REGISTERED' }, { status: 409 });
      }
      console.error('[passkeys/register POST]', err);
      return NextResponse.json({ error: 'DB_ERROR' }, { status: 500 });
    }
  });
}
