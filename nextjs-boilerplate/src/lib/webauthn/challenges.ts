/**
 * WebAuthn challenge management. Server vygeneruje random 32-byte challenge,
 * uloží do identity.webauthn_challenges, klient ho podepíše authenticator-em,
 * server pak verifikuje.
 *
 * Tahle implementace je SKELETON — pro production je třeba @simplewebauthn/server
 * (verifikace attestation + assertion signatures). Tady jen ukládáme/získáváme challenge.
 */
import crypto from 'node:crypto';
import { Pool } from 'pg';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

export interface ChallengeRow {
  id: string;
  challenge: Buffer;
  challenge_type: 'registration' | 'authentication';
  expires_at: string;
}

export async function createChallenge(
  userId: string | null,
  challengeType: 'registration' | 'authentication',
): Promise<{ id: string; challenge: string }> {
  const challenge = crypto.randomBytes(32);
  const r = await db().query<{ id: string }>(
    `INSERT INTO identity.webauthn_challenges (user_id, challenge, challenge_type)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [userId, challenge, challengeType],
  );
  return {
    id: r.rows[0].id,
    challenge: challenge.toString('base64url'),
  };
}

export async function consumeChallenge(
  challengeId: string,
): Promise<ChallengeRow | null> {
  const r = await db().query<ChallengeRow>(
    `UPDATE identity.webauthn_challenges
        SET consumed_at = now()
      WHERE id = $1 AND consumed_at IS NULL AND expires_at > now()
      RETURNING id, challenge, challenge_type, expires_at::text`,
    [challengeId],
  );
  return r.rows[0] ?? null;
}

export async function cleanupExpiredChallenges(): Promise<number> {
  const r = await db().query(
    `DELETE FROM identity.webauthn_challenges WHERE expires_at < now() - INTERVAL '1 hour'`,
  );
  return r.rowCount ?? 0;
}
