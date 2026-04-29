import type { DbAdapter, ImpersonationToken } from '../lib/types.js';
import { logAdminAction } from './platform-audit.service.js';

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

interface ImpersonationRow {
  token: string;
  admin_id: string;
  target_promoter_id: string;
  expires_at: string;
  revoked_at: string | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateToken(): string {
  // Generate a cryptographically random token of 48 hex chars (192 bits)
  const bytes = new Uint8Array(32);
  // Use Math.random as fallback for non-browser/non-node environments in tests
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function mapImpersonationRow(row: ImpersonationRow): ImpersonationToken {
  return {
    token: row.token,
    adminId: row.admin_id,
    targetPromoterId: row.target_promoter_id,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  };
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/**
 * Vytvoří dočasný impersonation token (platí 1 hodinu).
 * Uloží do DB a zapíše do audit logu.
 */
export async function createImpersonationToken(
  adminId: string,
  targetPromoterId: string,
  db: DbAdapter,
): Promise<ImpersonationToken> {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

  const rows = await db.query<ImpersonationRow>(
    `INSERT INTO admin_impersonation_tokens
       (token, admin_id, target_promoter_id, expires_at)
     VALUES ($1, $2, $3, $4)
     RETURNING token, admin_id, target_promoter_id,
               expires_at::TEXT, revoked_at::TEXT, created_at::TEXT`,
    [token, adminId, targetPromoterId, expiresAt],
  );

  const result = rows[0];
  if (!result) {
    throw new Error('Failed to create impersonation token');
  }

  await logAdminAction(
    {
      adminId,
      action: 'create_impersonation_token',
      targetType: 'impersonation',
      targetId: targetPromoterId,
      details: { expiresAt, token: token.substring(0, 8) + '...' },
    },
    db,
  );

  return mapImpersonationRow(result);
}

/**
 * Ověří impersonation token (ne expirovaný, správný promoter).
 */
export async function verifyImpersonationToken(
  token: string,
  db: DbAdapter,
): Promise<ImpersonationToken> {
  const rows = await db.query<ImpersonationRow>(
    `SELECT token, admin_id, target_promoter_id,
            expires_at::TEXT, revoked_at::TEXT, created_at::TEXT
     FROM admin_impersonation_tokens
     WHERE token = $1`,
    [token],
  );

  if (rows.length === 0) {
    throw new Error('Impersonation token not found');
  }

  const row = rows[0];

  if (row.revoked_at !== null) {
    throw new Error('Impersonation token has been revoked');
  }

  if (new Date(row.expires_at) < new Date()) {
    throw new Error('Impersonation token has expired');
  }

  return mapImpersonationRow(row);
}

/**
 * Zruší impersonation token (odhlášení z impersonace).
 */
export async function revokeImpersonationToken(token: string, db: DbAdapter): Promise<void> {
  await db.execute(
    `UPDATE admin_impersonation_tokens
     SET revoked_at = NOW()
     WHERE token = $1`,
    [token],
  );
}

/**
 * Vypíše aktivní impersonations (pro audit).
 */
export async function listActiveImpersonations(db: DbAdapter): Promise<ImpersonationToken[]> {
  const rows = await db.query<ImpersonationRow>(
    `SELECT token, admin_id, target_promoter_id,
            expires_at::TEXT, revoked_at::TEXT, created_at::TEXT
     FROM admin_impersonation_tokens
     WHERE revoked_at IS NULL
       AND expires_at > NOW()
     ORDER BY created_at DESC`,
  );

  return rows.map(mapImpersonationRow);
}
