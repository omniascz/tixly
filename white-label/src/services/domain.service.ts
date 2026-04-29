import { promises as dns } from 'dns';
import { WhiteLabelError, getCustomDomainAllowed } from '../lib/plan-enforcement';

export interface DomainDeps {
  db: {
    query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
    execute(sql: string, params?: unknown[]): Promise<void>;
  };
  redis: {
    set(key: string, value: string, options?: { ex?: number }): Promise<void>;
    del(key: string): Promise<void>;
  };
}

export interface CustomDomain {
  id: string;
  promoterId: string;
  domain: string;
  status: string;
  sslStatus: string;
  verifiedAt: string | null;
  sslProvisionedAt: string | null;
  verificationToken: string;
  verificationAttempts: number;
}

function rowToDomain(row: Record<string, unknown>): CustomDomain {
  return {
    id:                   row['id'] as string,
    promoterId:           row['promoter_id'] as string,
    domain:               row['domain'] as string,
    status:               row['status'] as string,
    sslStatus:            row['ssl_status'] as string,
    verifiedAt:           row['verified_at'] as string | null,
    sslProvisionedAt:     row['ssl_provisioned_at'] as string | null,
    verificationToken:    row['verification_token'] as string,
    verificationAttempts: Number(row['verification_attempts']),
  };
}

export async function createCustomDomain(
  promoterId: string,
  domain: string,
  deps: DomainDeps,
): Promise<CustomDomain> {
  // Zjisti plán
  const planRows = await deps.db.query<{ plan_tier: string }>(
    `SELECT COALESCE(t.plan_tier, 'starter') AS plan_tier
     FROM platform.promoters p
     LEFT JOIN platform.tenant_themes t ON t.promoter_id = p.id
     WHERE p.id = $1`,
    [promoterId],
  );
  if (!planRows.length) throw new WhiteLabelError('PROMOTER_NOT_FOUND', 'Promoter not found', 404);

  const planTier = planRows[0].plan_tier as 'starter' | 'pro' | 'enterprise';
  if (!getCustomDomainAllowed(planTier)) {
    throw new WhiteLabelError(
      'PLAN_FEATURE_NOT_AVAILABLE',
      'Custom domains require Pro or Enterprise plan',
      422,
    );
  }

  // Normalizace domény
  const normalizedDomain = domain.toLowerCase().trim().replace(/\/$/, '');
  if (!/^[a-z0-9.-]{4,253}$/.test(normalizedDomain)) {
    throw new WhiteLabelError('INVALID_DOMAIN', 'Invalid domain format', 422);
  }

  const rows = await deps.db.query<Record<string, unknown>>(
    `INSERT INTO platform.custom_domains (promoter_id, domain)
     VALUES ($1, $2)
     ON CONFLICT (domain) DO NOTHING
     RETURNING *`,
    [promoterId, normalizedDomain],
  );

  if (!rows.length) {
    throw new WhiteLabelError('DOMAIN_ALREADY_TAKEN', 'Domain is already registered', 409);
  }

  return rowToDomain(rows[0]);
}

export async function verifyDomain(
  domainId: string,
  promoterId: string,
  deps: DomainDeps,
): Promise<CustomDomain> {
  const rows = await deps.db.query<Record<string, unknown>>(
    `SELECT * FROM platform.custom_domains WHERE id = $1 AND promoter_id = $2`,
    [domainId, promoterId],
  );
  if (!rows.length) throw new WhiteLabelError('DOMAIN_NOT_FOUND', 'Domain not found', 404);

  const domainRow = rows[0];
  const domain = domainRow['domain'] as string;
  const token = domainRow['verification_token'] as string;

  // DNS lookup
  let verified = false;
  try {
    const txtRecords = await dns.resolveTxt(`_tixly-verify.${domain}`);
    verified = txtRecords.some(record =>
      record.some(chunk => chunk === `tixly-verify=${token}`),
    );
  } catch {
    // DNS lookup selhalo — doména ještě nepropagována
  }

  // Aktualizuj počet pokusů
  await deps.db.execute(
    `UPDATE platform.custom_domains
     SET verification_attempts = verification_attempts + 1,
         last_verification_attempt = NOW(),
         verified_at = CASE WHEN $1 THEN NOW() ELSE verified_at END,
         status = CASE WHEN $1 THEN 'verified' ELSE status END,
         updated_at = NOW()
     WHERE id = $2`,
    [verified, domainId],
  );

  if (verified) {
    // Aktivuj doménu v Redis cache pro middleware
    await deps.redis.set(`domain:${domain}`, promoterId, { ex: 300 });
  }

  const updated = await deps.db.query<Record<string, unknown>>(
    `SELECT * FROM platform.custom_domains WHERE id = $1`,
    [domainId],
  );
  return rowToDomain(updated[0]);
}

export async function listDomains(
  promoterId: string,
  deps: DomainDeps,
): Promise<CustomDomain[]> {
  const rows = await deps.db.query<Record<string, unknown>>(
    `SELECT * FROM platform.custom_domains WHERE promoter_id = $1 ORDER BY created_at DESC`,
    [promoterId],
  );
  return rows.map(rowToDomain);
}

export async function deleteDomain(
  domainId: string,
  promoterId: string,
  deps: DomainDeps,
): Promise<void> {
  const rows = await deps.db.query<Record<string, unknown>>(
    `SELECT domain FROM platform.custom_domains WHERE id = $1 AND promoter_id = $2`,
    [domainId, promoterId],
  );
  if (!rows.length) throw new WhiteLabelError('DOMAIN_NOT_FOUND', 'Domain not found', 404);

  const domain = rows[0]['domain'] as string;

  await deps.db.execute(
    `DELETE FROM platform.custom_domains WHERE id = $1 AND promoter_id = $2`,
    [domainId, promoterId],
  );

  await deps.redis.del(`domain:${domain}`);
}
