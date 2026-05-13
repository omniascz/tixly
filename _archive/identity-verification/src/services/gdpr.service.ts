/**
 * GDPR data management — export and erasure for verified identities.
 *
 * - exportUserData: returns all PII associated with a user (decrypted)
 * - eraseUserData: soft-unlinks identity and deletes purchase tracking data
 */

import { getDecryptedIdentity, type IdentityDeps } from './bankid.service.js';

export interface GdprExport {
  userId: string;
  identity: {
    firstName: string;
    lastName: string;
    birthdate: string;
    idcardExpiry: string | null;
  } | null;
  verificationAttempts: Array<{
    provider: string;
    outcome: string;
    createdAt: string;
  }>;
  onfidoVerifications: Array<{
    status: string;
    result: string | null;
    createdAt: string;
  }>;
  purchaseRecords: Array<{
    eventId: string;
    ticketCount: number;
    purchasedAt: string;
  }>;
}

/**
 * Export all identity-related data for GDPR subject access request.
 */
export async function exportUserData(
  userId: string,
  deps: IdentityDeps,
): Promise<GdprExport> {
  const [identity, attempts, onfido, purchases] = await Promise.all([
    getDecryptedIdentity(userId, deps),
    deps.db.query<{ provider: string; outcome: string; created_at: string }>(
      `SELECT provider, outcome, created_at::text AS created_at
       FROM identity.verification_attempts
       WHERE user_id = $1 ORDER BY created_at DESC`,
      [userId],
    ),
    deps.db.query<{ status: string; result: string | null; created_at: string }>(
      `SELECT status, result, created_at::text AS created_at
       FROM identity.onfido_verifications
       WHERE user_id = $1 ORDER BY created_at DESC`,
      [userId],
    ),
    deps.db.query<{ event_id: string; ticket_count: number; purchased_at: string }>(
      `SELECT ip.event_id, ip.ticket_count, ip.purchased_at::text AS purchased_at
       FROM identity.identity_purchases ip
       JOIN identity.user_verifications uv ON uv.user_id = $1
       JOIN identity.verified_persons vp ON vp.id = uv.verified_person_id
       WHERE ip.identity_hash = encode(
         hmac(vp.birthdate_enc || vp.bank_id_sub, current_setting('app.identity_hash_salt'), 'sha256'),
         'hex'
       )
       ORDER BY ip.purchased_at DESC`,
      [userId],
    ).catch(() => [] as any[]), // graceful if identity_purchases doesn't exist yet
  ]);

  return {
    userId,
    identity,
    verificationAttempts: attempts.map((a) => ({
      provider: a.provider,
      outcome: a.outcome,
      createdAt: a.created_at,
    })),
    onfidoVerifications: onfido.map((o) => ({
      status: o.status,
      result: o.result,
      createdAt: o.created_at,
    })),
    purchaseRecords: purchases.map((p) => ({
      eventId: p.event_id,
      ticketCount: p.ticket_count,
      purchasedAt: p.purchased_at,
    })),
  };
}

/**
 * GDPR right to erasure — soft-unlinks identity, removes auth sessions,
 * and clears purchase tracking data.
 */
export async function eraseUserData(
  userId: string,
  deps: IdentityDeps,
): Promise<{ unlinked: boolean; sessionsDeleted: number; purchasesDeleted: number }> {
  // 1. Soft-unlink user verification (set unlinked_at)
  const unlinkRows = await deps.db.query<{ id: string }>(
    `UPDATE identity.user_verifications
     SET unlinked_at = NOW()
     WHERE user_id = $1 AND unlinked_at IS NULL
     RETURNING id`,
    [userId],
  );

  // 2. Delete auth sessions
  const sessionRows = await deps.db.query<{ state: string }>(
    `DELETE FROM identity.bankid_auth_sessions
     WHERE user_id = $1
     RETURNING state`,
    [userId],
  );

  // 3. Delete purchase tracking records (identity hash based)
  // We need to find the identity hash from the user's verified person
  let purchasesDeleted = 0;
  const identityRows = await deps.db.query<{ identity_hash: string }>(
    `SELECT ip.identity_hash FROM identity.identity_purchases ip
     WHERE ip.identity_hash IN (
       SELECT encode(
         hmac(vp.birthdate_enc || vp.bank_id_sub, current_setting('app.identity_hash_salt', true), 'sha256'),
         'hex'
       )
       FROM identity.user_verifications uv
       JOIN identity.verified_persons vp ON vp.id = uv.verified_person_id
       WHERE uv.user_id = $1
     )
     LIMIT 1`,
    [userId],
  ).catch(() => []);

  if (identityRows.length > 0) {
    const deleteRows = await deps.db.query<{ id: string }>(
      `DELETE FROM identity.identity_purchases
       WHERE identity_hash = $1
       RETURNING id`,
      [identityRows[0].identity_hash],
    );
    purchasesDeleted = deleteRows.length;
  }

  // 4. Clean Redis sessions
  await deps.redis.del(`identity:bankid:user:${userId}`).catch(() => {});

  return {
    unlinked: unlinkRows.length > 0,
    sessionsDeleted: sessionRows.length,
    purchasesDeleted,
  };
}
