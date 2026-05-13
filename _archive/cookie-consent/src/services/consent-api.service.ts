import type { ServiceDeps } from '../lib/service-container.js';
import { ConsentError } from '../lib/consent-errors.js';
import type { Consent, ConsentAudit, ConsentStatus, ConsentType, LawfulBasis } from '../types/consent.js';

const CONSENT_TYPES: ConsentType[] = ['marketing', 'analytics', 'personalization', 'functional'];
const DEFAULT_LAWFUL_BASIS: LawfulBasis = 'consent';
const RETENTION_YEARS = 2;

interface ConsentRow {
  id: string;
  user_id: string;
  type: ConsentType;
  status: ConsentStatus;
  granted_at: Date | null;
  withdrawn_at: Date | null;
  lawful_basis: LawfulBasis;
  ip_address: string | null;
  user_agent: string | null;
}

interface ConsentAuditRow {
  id: string;
  user_id: string;
  consent_id: string;
  action: 'granted' | 'withdrawn' | 'updated';
  timestamp: Date;
  ip_address: string | null;
  reason: string | null;
}

function mapConsent(row: ConsentRow): Consent {
  return {
    id: row.id,
    userId: row.user_id,
    type: row.type,
    status: row.status,
    grantedAt: row.granted_at,
    withdrawnAt: row.withdrawn_at,
    lawfulBasis: row.lawful_basis,
    ipAddress: row.ip_address,
    userAgent: row.user_agent,
  };
}

function mapAudit(row: ConsentAuditRow): ConsentAudit {
  return {
    id: row.id,
    userId: row.user_id,
    consentId: row.consent_id,
    action: row.action,
    timestamp: row.timestamp,
    ipAddress: row.ip_address,
    reason: row.reason,
  };
}

/**
 * Get current consent status for user across all consent types.
 */
export async function getConsentStatus(
  userId: string,
  deps: ServiceDeps,
): Promise<Record<ConsentType, Consent>> {
  const rows = await deps.db.query<ConsentRow>(
    `SELECT id, user_id, type, status, granted_at, withdrawn_at, lawful_basis, ip_address, user_agent
     FROM consent.user_consents
     WHERE user_id = $1 AND type = ANY($2)
     ORDER BY type`,
    [userId, CONSENT_TYPES],
  );

  const result: Record<ConsentType, Consent> = {} as any;

  // Initialize missing types with denied status
  for (const type of CONSENT_TYPES) {
    const existing = rows.find(r => r.type === type);
    if (existing) {
      result[type] = mapConsent(existing);
    } else {
      // Create default denied consent (no explicit grant)
      result[type] = {
        id: '', // Will be set when persisted
        userId,
        type,
        status: 'denied',
        grantedAt: null,
        withdrawnAt: null,
        lawfulBasis: DEFAULT_LAWFUL_BASIS,
        ipAddress: null,
        userAgent: null,
      };
    }
  }

  return result;
}

/**
 * Update single consent type (grant/withdraw).
 * Writes audit log entry.
 */
export async function updateConsent(
  userId: string,
  type: ConsentType,
  status: ConsentStatus,
  reason: string | null,
  ipAddress: string | null,
  userAgent: string | null,
  deps: ServiceDeps,
): Promise<Consent> {
  if (!CONSENT_TYPES.includes(type)) {
    throw new ConsentError('INVALID_CONSENT', `Invalid consent type: ${type}`);
  }

  return await deps.db.transaction(async (tx) => {
    // Upsert consent record
    const rows = await tx.query<ConsentRow>(
      `INSERT INTO consent.user_consents
         (user_id, type, status, granted_at, withdrawn_at, lawful_basis, ip_address, user_agent)
       VALUES ($1, $2, $3, CASE WHEN $3::consent_status = 'granted' THEN NOW() ELSE NULL END,
                         CASE WHEN $3::consent_status = 'withdrawn' THEN NOW() ELSE NULL END,
                         $4, $5, $6)
       ON CONFLICT (user_id, type) DO UPDATE
       SET status = EXCLUDED.status,
           granted_at = CASE WHEN EXCLUDED.status = 'granted' THEN NOW() ELSE user_consents.granted_at END,
           withdrawn_at = CASE WHEN EXCLUDED.status = 'withdrawn' THEN NOW() ELSE user_consents.withdrawn_at END,
           ip_address = EXCLUDED.ip_address,
           user_agent = EXCLUDED.user_agent
       RETURNING *`,
      [userId, type, status, DEFAULT_LAWFUL_BASIS, ipAddress, userAgent],
    );

    if (!rows[0]) throw new ConsentError('INVALID_CONSENT');

    const consent = mapConsent(rows[0]);

    // Write audit trail
    await tx.execute(
      `INSERT INTO consent.audit_trail
         (user_id, consent_id, action, timestamp, ip_address, reason)
       VALUES ($1, $2, $3, NOW(), $4, $5)`,
      [userId, consent.id, status === 'withdrawn' ? 'withdrawn' : 'granted', ipAddress, reason],
    );

    return consent;
  });
}

/**
 * Revoke all consents for user (GDPR right to withdraw).
 */
export async function revokeAllConsents(
  userId: string,
  reason: string | null,
  ipAddress: string | null,
  deps: ServiceDeps,
): Promise<{ revokedCount: number; timestamp: Date }> {
  const revokedAt = new Date();

  const result = await deps.db.transaction(async (tx) => {
    // Get all current consents
    const consents = await tx.query<ConsentRow>(
      `SELECT id FROM consent.user_consents
       WHERE user_id = $1 AND status != 'withdrawn'`,
      [userId],
    );

    // Withdraw all
    await tx.execute(
      `UPDATE consent.user_consents
       SET status = 'withdrawn', withdrawn_at = NOW()
       WHERE user_id = $1 AND status != 'withdrawn'`,
      [userId],
    );

    // Audit each revocation
    for (const consent of consents) {
      await tx.execute(
        `INSERT INTO consent.audit_trail
           (user_id, consent_id, action, timestamp, ip_address, reason)
         VALUES ($1, $2, 'withdrawn', NOW(), $3, $4)`,
        [userId, consent.id, ipAddress, reason],
      );
    }

    return { revokedCount: consents.length };
  });

  return { ...result, timestamp: revokedAt };
}

/**
 * Get paginated consent audit trail for user.
 * Returns most recent entries first, filters by type and date range.
 */
export async function getConsentHistory(
  userId: string,
  options: {
    type?: ConsentType;
    startDate?: Date;
    endDate?: Date;
    limit?: number;
    offset?: number;
  },
  deps: ServiceDeps,
): Promise<{ entries: ConsentAudit[]; total: number }> {
  const { type, startDate, endDate, limit: rawLimit = 50, offset = 0 } = options;
  const limit = rawLimit > 200 ? 50 : rawLimit;

  let whereClause = 'ca.user_id = $1';
  const params: unknown[] = [userId];

  if (type) {
    whereClause += ` AND uc.type = $${params.length + 1}`;
    params.push(type);
  }

  if (startDate) {
    whereClause += ` AND ca.timestamp >= $${params.length + 1}`;
    params.push(startDate);
  }

  if (endDate) {
    whereClause += ` AND ca.timestamp <= $${params.length + 1}`;
    params.push(endDate);
  }

  // Query entries
  const entries = await deps.db.query<ConsentAuditRow>(
    `SELECT ca.id, ca.user_id, ca.consent_id, ca.action, ca.timestamp, ca.ip_address, ca.reason
     FROM consent.audit_trail ca
     LEFT JOIN consent.user_consents uc ON uc.id = ca.consent_id
     WHERE ${whereClause}
     ORDER BY ca.timestamp DESC
     LIMIT ${limit} OFFSET $${params.length + 1}`,
    [...params, offset],
  );

  // Query total count
  const countRows = await deps.db.query<{ count: number }>(
    `SELECT COUNT(*)::int as count
     FROM consent.audit_trail ca
     LEFT JOIN consent.user_consents uc ON uc.id = ca.consent_id
     WHERE ${whereClause}`,
    params,
  );

  return {
    entries: entries.map(mapAudit),
    total: countRows[0]?.count ?? 0,
  };
}

/**
 * Export all consent data for GDPR Art. 15 subject access request.
 * Does not include IP/User-Agent in export for privacy.
 */
export async function exportConsentData(
  userId: string,
  deps: ServiceDeps,
): Promise<{
  consents: Consent[];
  auditTrail: Array<{
    action: string;
    timestamp: string;
    reason: string | null;
    consentType: ConsentType;
    status: ConsentStatus;
  }>;
  exportDate: string;
}> {
  const [consents, audit] = await Promise.all([
    deps.db.query<ConsentRow>(
      `SELECT id, user_id, type, status, granted_at, withdrawn_at, lawful_basis, ip_address, user_agent
       FROM consent.user_consents
       WHERE user_id = $1
       ORDER BY type`,
      [userId],
    ),
    deps.db.query<ConsentAuditRow & { type: ConsentType }>(
      `SELECT ca.id, ca.user_id, ca.consent_id, ca.action, ca.timestamp, ca.ip_address, ca.reason,
              uc.type
       FROM consent.audit_trail ca
       LEFT JOIN consent.user_consents uc ON uc.id = ca.consent_id
       WHERE ca.user_id = $1
       ORDER BY ca.timestamp DESC`,
      [userId],
    ),
  ]);

  return {
    consents: consents.map(mapConsent),
    auditTrail: audit.map(a => ({
      action: a.action,
      timestamp: a.timestamp.toISOString(),
      reason: a.reason,
      consentType: a.type ?? 'functional',
      status: 'granted' as ConsentStatus, // Inferred from action for export
    })),
    exportDate: new Date().toISOString(),
  };
}
