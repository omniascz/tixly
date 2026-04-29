import type { DeviceDeps } from './device.service.js';

export interface BlocklistEntry {
  id: string;
  fingerprintHash: string;
  reason: string;
  blockedBy: string;
  blockedAt: string;
  expiresAt: string | null;
}

export async function addToBlocklist(
  fingerprintHash: string,
  reason: string,
  blockedBy: string,
  expiresAt: Date | null,
  deps: DeviceDeps,
): Promise<BlocklistEntry> {
  const rows = await deps.db.query<BlocklistEntry>(
    `INSERT INTO risk.fingerprint_blocklist
       (fingerprint_hash, reason, blocked_by, expires_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (fingerprint_hash) DO UPDATE
       SET reason = EXCLUDED.reason,
           blocked_by = EXCLUDED.blocked_by,
           expires_at = EXCLUDED.expires_at,
           blocked_at = NOW()
     RETURNING id, fingerprint_hash AS "fingerprintHash", reason,
               blocked_by AS "blockedBy",
               blocked_at::text AS "blockedAt",
               expires_at::text AS "expiresAt"`,
    [fingerprintHash, reason, blockedBy, expiresAt?.toISOString() ?? null],
  );
  return rows[0];
}

export async function removeFromBlocklist(
  fingerprintHash: string,
  deps: DeviceDeps,
): Promise<boolean> {
  const rows = await deps.db.query<{ count: string }>(
    `DELETE FROM risk.fingerprint_blocklist
     WHERE fingerprint_hash = $1
     RETURNING id`,
    [fingerprintHash],
  );
  return rows.length > 0;
}

export async function listBlocklist(
  limit: number,
  offset: number,
  deps: DeviceDeps,
): Promise<{ entries: BlocklistEntry[]; total: number }> {
  const [entries, countRows] = await Promise.all([
    deps.db.query<BlocklistEntry>(
      `SELECT id, fingerprint_hash AS "fingerprintHash", reason,
              blocked_by AS "blockedBy",
              blocked_at::text AS "blockedAt",
              expires_at::text AS "expiresAt"
       FROM risk.fingerprint_blocklist
       ORDER BY blocked_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset],
    ),
    deps.db.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM risk.fingerprint_blocklist`,
    ),
  ]);
  return { entries, total: parseInt(countRows[0]?.count ?? '0', 10) };
}

export async function isBlocked(
  fingerprintHash: string,
  deps: DeviceDeps,
): Promise<boolean> {
  const rows = await deps.db.query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM risk.fingerprint_blocklist
     WHERE fingerprint_hash = $1 AND (expires_at IS NULL OR expires_at > NOW())`,
    [fingerprintHash],
  );
  return parseInt(rows[0]?.count ?? '0', 10) > 0;
}
