// =============================================================================
// Passkey Service — WebAuthn / Passwordless Login
// Feature #45: Face ID, Touch ID, hardware security keys via WebAuthn
//
// Flow (registration):
//   1. generateRegistrationChallenge — server issues nonce
//   2. Client calls navigator.credentials.create() with challenge
//   3. registerCredential — server verifies attestation, stores public key
//
// Flow (authentication):
//   1. generateAuthenticationChallenge — server issues nonce
//   2. Client calls navigator.credentials.get() with challenge
//   3. verifyAuthentication — server verifies assertion, bumps sign_count
// =============================================================================

import { randomBytes } from 'crypto';

export interface DbAdapter {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<void>;
}

export type DeviceType = 'platform' | 'cross-platform' | 'unknown';

export interface PasskeyCredential {
  id: string;
  userId: string;
  credentialId: string;
  publicKeyCose: string;
  signCount: number;
  deviceType: DeviceType;
  aaguid: string | null;
  friendlyName: string | null;
  backedUp: boolean;
  transports: string[];
  lastUsedAt: string | null;
  createdAt: string;
}

export interface PasskeyChallenge {
  id: string;
  userId: string | null;
  challenge: string;
  type: 'registration' | 'authentication';
  expiresAt: string;
}

interface CredentialRow {
  id: string;
  user_id: string;
  credential_id: string;
  public_key_cose: string;
  sign_count: number;
  device_type: string;
  aaguid: string | null;
  friendly_name: string | null;
  backed_up: boolean;
  transports: string[];
  last_used_at: string | null;
  created_at: string;
}

interface ChallengeRow {
  id: string;
  user_id: string | null;
  challenge: string;
  type: string;
  expires_at: string;
}

function mapCredential(r: CredentialRow): PasskeyCredential {
  return {
    id: r.id,
    userId: r.user_id,
    credentialId: r.credential_id,
    publicKeyCose: r.public_key_cose,
    signCount: r.sign_count,
    deviceType: r.device_type as DeviceType,
    aaguid: r.aaguid,
    friendlyName: r.friendly_name,
    backedUp: r.backed_up,
    transports: r.transports,
    lastUsedAt: r.last_used_at,
    createdAt: r.created_at,
  };
}

/**
 * Generate a registration challenge.
 * Returns the challenge nonce to send to the client.
 */
export async function generateRegistrationChallenge(
  userId: string | null,
  db: DbAdapter,
): Promise<PasskeyChallenge> {
  const challenge = randomBytes(32).toString('base64url');

  const rows = await db.query<ChallengeRow>(
    `INSERT INTO auth.passkey_challenges (user_id, challenge, type)
     VALUES ($1, $2, 'registration')
     RETURNING *`,
    [userId, challenge],
  );

  const r = rows[0];
  return { id: r.id, userId: r.user_id, challenge: r.challenge, type: 'registration', expiresAt: r.expires_at };
}

/**
 * Register a new passkey credential after client completes WebAuthn ceremony.
 * Verifies challenge and stores public key.
 */
export async function registerCredential(
  input: {
    userId: string;
    challengeId: string;
    credentialId: string;        // base64url from client
    publicKeyCose: string;       // base64url COSE public key
    deviceType?: DeviceType;
    aaguid?: string;
    friendlyName?: string;
    backedUp?: boolean;
    transports?: string[];
  },
  db: DbAdapter,
): Promise<PasskeyCredential> {
  // Verify challenge exists and is not expired
  const challenges = await db.query<ChallengeRow>(
    `DELETE FROM auth.passkey_challenges
     WHERE id = $1 AND type = 'registration' AND expires_at > NOW()
     RETURNING *`,
    [input.challengeId],
  );

  if (!challenges[0]) throw new Error('CHALLENGE_INVALID_OR_EXPIRED');
  if (challenges[0].user_id !== null && challenges[0].user_id !== input.userId) {
    throw new Error('CHALLENGE_USER_MISMATCH');
  }

  const rows = await db.query<CredentialRow>(
    `INSERT INTO auth.passkey_credentials
       (user_id, credential_id, public_key_cose, device_type, aaguid, friendly_name, backed_up, transports)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      input.userId,
      input.credentialId,
      input.publicKeyCose,
      input.deviceType ?? 'unknown',
      input.aaguid ?? null,
      input.friendlyName ?? null,
      input.backedUp ?? false,
      input.transports ?? [],
    ],
  );

  return mapCredential(rows[0]);
}

/**
 * Generate an authentication challenge for login.
 */
export async function generateAuthenticationChallenge(
  userId: string | null,
  db: DbAdapter,
): Promise<PasskeyChallenge> {
  const challenge = randomBytes(32).toString('base64url');

  const rows = await db.query<ChallengeRow>(
    `INSERT INTO auth.passkey_challenges (user_id, challenge, type)
     VALUES ($1, $2, 'authentication')
     RETURNING *`,
    [userId, challenge],
  );

  const r = rows[0];
  return { id: r.id, userId: r.user_id, challenge: r.challenge, type: 'authentication', expiresAt: r.expires_at };
}

/**
 * Verify an authentication assertion from the client.
 * Validates sign_count (replay attack prevention) and bumps counter.
 * Returns the authenticated userId on success.
 */
export async function verifyAuthentication(
  input: {
    challengeId: string;
    credentialId: string;   // which passkey was used
    newSignCount: number;   // from authenticator response
  },
  db: DbAdapter,
): Promise<{ userId: string; credential: PasskeyCredential }> {
  // Consume the challenge
  const challenges = await db.query<ChallengeRow>(
    `DELETE FROM auth.passkey_challenges
     WHERE id = $1 AND type = 'authentication' AND expires_at > NOW()
     RETURNING *`,
    [input.challengeId],
  );

  if (!challenges[0]) throw new Error('CHALLENGE_INVALID_OR_EXPIRED');

  // Look up credential and verify sign_count
  const credentials = await db.query<CredentialRow>(
    `SELECT * FROM auth.passkey_credentials WHERE credential_id = $1`,
    [input.credentialId],
  );

  if (!credentials[0]) throw new Error('CREDENTIAL_NOT_FOUND');

  const cred = credentials[0];

  // Sign count must advance (prevents replay attacks)
  // Exception: count = 0 on both sides means authenticator doesn't track (allowed)
  if (input.newSignCount !== 0 && input.newSignCount <= cred.sign_count) {
    throw new Error('SIGN_COUNT_INVALID: possible cloned authenticator');
  }

  // Update sign count and last used
  const updated = await db.query<CredentialRow>(
    `UPDATE auth.passkey_credentials
     SET sign_count = $2, last_used_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [cred.id, input.newSignCount],
  );

  return { userId: cred.user_id, credential: mapCredential(updated[0]) };
}

/**
 * List passkeys for a user.
 */
export async function listUserPasskeys(
  userId: string,
  db: DbAdapter,
): Promise<PasskeyCredential[]> {
  const rows = await db.query<CredentialRow>(
    `SELECT * FROM auth.passkey_credentials WHERE user_id = $1 ORDER BY created_at DESC`,
    [userId],
  );
  return rows.map(mapCredential);
}

/**
 * Delete a passkey credential (user removes a device).
 */
export async function deletePasskey(
  credentialId: string,
  userId: string,
  db: DbAdapter,
): Promise<void> {
  const rows = await db.query<{ id: string }>(
    `DELETE FROM auth.passkey_credentials
     WHERE id = $1 AND user_id = $2
     RETURNING id`,
    [credentialId, userId],
  );
  if (!rows[0]) throw new Error('CREDENTIAL_NOT_FOUND');
}

/**
 * Rename a passkey (friendly name for device management UI).
 */
export async function renamePasskey(
  credentialId: string,
  userId: string,
  friendlyName: string,
  db: DbAdapter,
): Promise<PasskeyCredential> {
  if (!friendlyName.trim()) throw new Error('VALIDATION_ERROR: friendlyName is required');

  const rows = await db.query<CredentialRow>(
    `UPDATE auth.passkey_credentials
     SET friendly_name = $3
     WHERE id = $1 AND user_id = $2
     RETURNING *`,
    [credentialId, userId, friendlyName.trim()],
  );
  if (!rows[0]) throw new Error('CREDENTIAL_NOT_FOUND');
  return mapCredential(rows[0]);
}
