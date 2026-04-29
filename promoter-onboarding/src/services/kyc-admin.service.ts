// =============================================================================
// KYC Admin Service — rozšíření admin funkcí nad onboarding.service.ts
// Pokrývá: document signed URL, promoter search, suspend/ban, stats
// =============================================================================

import type { ServiceDeps } from '../lib/service-container';
import { OnboardingError } from '../lib/onboarding-errors';

// ---------------------------------------------------------------------------
// Typy
// ---------------------------------------------------------------------------

export interface KycQueueStats {
  pending: number;           // čeká na review
  submittedToday: number;    // odesláno dnes
  approvedToday: number;
  rejectedToday: number;
  avgReviewHours: number | null; // průměrná doba review (posledních 30 dní)
}

export interface PromoterSearchResult {
  id: string;
  name: string;
  legalName: string | null;
  ico: string;
  status: string;
  kycStatus: string;
  createdAt: string;
  documentCount: number;
  lastReviewAt: string | null;
}

export interface PromoterSearchFilters {
  query?: string;        // fulltext přes name, legalName, ico
  status?: string;       // pending | active | suspended | banned
  kycStatus?: string;    // not_started | submitted | verified | rejected
  from?: string;         // ISO8601
  to?: string;
  limit: number;
  offset: number;
}

// ---------------------------------------------------------------------------
// DB adapter (nadstavba nad ServiceDeps.db)
// ---------------------------------------------------------------------------

interface KycAdminDB {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<void>;
}

// ---------------------------------------------------------------------------
// 1. Stats fronty KYC
// ---------------------------------------------------------------------------

export async function getKycQueueStats(deps: ServiceDeps): Promise<KycQueueStats> {
  const db = deps.db as unknown as KycAdminDB;

  const [pendingRow] = await db.query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM platform.promoters WHERE kyc_status = 'submitted'`,
  );

  const [todayRow] = await db.query<{
    submitted_today: string;
    approved_today: string;
    rejected_today: string;
  }>(
    `SELECT
       COUNT(*) FILTER (WHERE p.kyc_status = 'submitted' AND DATE(p.updated_at) = CURRENT_DATE) AS submitted_today,
       COUNT(*) FILTER (WHERE kr.decision = 'approved' AND DATE(kr.created_at) = CURRENT_DATE) AS approved_today,
       COUNT(*) FILTER (WHERE kr.decision = 'rejected' AND DATE(kr.created_at) = CURRENT_DATE) AS rejected_today
     FROM platform.promoters p
     LEFT JOIN platform.kyc_reviews kr ON kr.promoter_id = p.id`,
  );

  const [avgRow] = await db.query<{ avg_hours: string | null }>(
    `SELECT
       ROUND(AVG(EXTRACT(EPOCH FROM (kr.created_at - p.updated_at)) / 3600), 1) AS avg_hours
     FROM platform.kyc_reviews kr
     JOIN platform.promoters p ON p.id = kr.promoter_id
     WHERE kr.decision IN ('approved', 'rejected')
       AND kr.created_at >= NOW() - INTERVAL '30 days'`,
  );

  return {
    pending: parseInt(pendingRow?.count ?? '0', 10),
    submittedToday: parseInt(todayRow?.submitted_today ?? '0', 10),
    approvedToday: parseInt(todayRow?.approved_today ?? '0', 10),
    rejectedToday: parseInt(todayRow?.rejected_today ?? '0', 10),
    avgReviewHours: avgRow?.avg_hours ? parseFloat(avgRow.avg_hours) : null,
  };
}

// ---------------------------------------------------------------------------
// 2. Vyhledávání promotérů (admin pohled)
// ---------------------------------------------------------------------------

export async function searchPromoters(
  filters: PromoterSearchFilters,
  deps: ServiceDeps,
): Promise<{ items: PromoterSearchResult[]; total: number }> {
  const db = deps.db as unknown as KycAdminDB;

  const conditions: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (filters.query) {
    conditions.push(
      `(p.name ILIKE $${idx} OR p.legal_name ILIKE $${idx} OR p.ico = $${idx + 1})`,
    );
    params.push(`%${filters.query}%`, filters.query);
    idx += 2;
  }

  if (filters.status) {
    conditions.push(`p.status = $${idx}`);
    params.push(filters.status);
    idx++;
  }

  if (filters.kycStatus) {
    conditions.push(`p.kyc_status = $${idx}`);
    params.push(filters.kycStatus);
    idx++;
  }

  if (filters.from) {
    conditions.push(`p.created_at >= $${idx}`);
    params.push(filters.from);
    idx++;
  }

  if (filters.to) {
    conditions.push(`p.created_at <= $${idx}`);
    params.push(filters.to);
    idx++;
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const rows = await db.query<{
    id: string;
    name: string;
    legal_name: string | null;
    ico: string;
    status: string;
    kyc_status: string;
    created_at: string;
    document_count: string;
    last_review_at: string | null;
  }>(
    `SELECT
       p.id, p.name, p.legal_name, p.ico, p.status, p.kyc_status, p.created_at,
       COUNT(DISTINCT kd.id) AS document_count,
       MAX(kr.created_at) AS last_review_at
     FROM platform.promoters p
     LEFT JOIN platform.kyc_documents kd ON kd.promoter_id = p.id
     LEFT JOIN platform.kyc_reviews kr ON kr.promoter_id = p.id
     ${where}
     GROUP BY p.id, p.name, p.legal_name, p.ico, p.status, p.kyc_status, p.created_at
     ORDER BY p.created_at DESC
     LIMIT $${idx} OFFSET $${idx + 1}`,
    [...params, filters.limit, filters.offset],
  );

  const [countRow] = await db.query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM platform.promoters p ${where}`,
    params,
  );

  return {
    items: rows.map((r) => ({
      id: r.id,
      name: r.name,
      legalName: r.legal_name,
      ico: r.ico,
      status: r.status,
      kycStatus: r.kyc_status,
      createdAt: r.created_at,
      documentCount: parseInt(r.document_count, 10),
      lastReviewAt: r.last_review_at,
    })),
    total: parseInt(countRow?.count ?? '0', 10),
  };
}

// ---------------------------------------------------------------------------
// 3. Suspend / ban / reactivate promotéra
// ---------------------------------------------------------------------------

export type PromoterStatusAction = 'suspend' | 'ban' | 'reactivate';

export async function changePromoterStatus(
  promoterId: string,
  adminUserId: string,
  action: PromoterStatusAction,
  reason: string,
  deps: ServiceDeps,
): Promise<void> {
  const db = deps.db as unknown as KycAdminDB;

  const [promoter] = await db.query<{ id: string; status: string }>(
    'SELECT id, status FROM platform.promoters WHERE id = $1',
    [promoterId],
  );

  if (!promoter) {
    throw new OnboardingError('ONBOARDING_NOT_FOUND');
  }

  // Validace přechodů stavů
  const allowedFrom: Record<PromoterStatusAction, string[]> = {
    suspend:    ['active'],
    ban:        ['active', 'suspended', 'pending'],
    reactivate: ['suspended'],
  };

  if (!allowedFrom[action].includes(promoter.status)) {
    throw new OnboardingError('INVALID_STATUS_TRANSITION');
  }

  const newStatus: Record<PromoterStatusAction, string> = {
    suspend:    'suspended',
    ban:        'banned',
    reactivate: 'active',
  };

  await db.execute(
    `UPDATE platform.promoters SET status = $1 WHERE id = $2`,
    [newStatus[action], promoterId],
  );

  // Audit záznam (reuse kyc_reviews tabulka pro admin akce)
  await db.execute(
    `INSERT INTO platform.kyc_reviews (promoter_id, admin_user_id, decision, notes)
     VALUES ($1, $2, $3, $4)`,
    [promoterId, adminUserId, `status_${action}`, reason],
  );

  deps.kafka
    .send(`promoter.${action}ed`, { promoterId, adminUserId, reason })
    .catch(() => {});

  // Notifikace promotérovi
  const [owner] = await db.query<{ email: string; name: string }>(
    `SELECT u.email, p.name
     FROM identity.users u
     JOIN platform.promoter_members pm ON pm.user_id = u.id
     JOIN platform.promoters p ON p.id = pm.promoter_id
     WHERE pm.promoter_id = $1 AND pm.role = 'owner'`,
    [promoterId],
  );

  if (owner) {
    const subjects: Record<PromoterStatusAction, string> = {
      suspend:    'Váš účet byl dočasně pozastaven',
      ban:        'Váš účet byl zablokován',
      reactivate: 'Váš účet byl reaktivován',
    };
    await deps.email.send(
      owner.email,
      subjects[action],
      `<p>Dobrý den ${owner.name},</p><p>${reason}</p>`,
    );
  }
}

// ---------------------------------------------------------------------------
// 4. Presigned URL pro stažení dokumentu (admin)
// ---------------------------------------------------------------------------

export interface StorageAdapter {
  /** Vrátí dočasnou podepsanou URL pro čtení objektu. TTL v sekundách. */
  getSignedDownloadUrl(storageKey: string, ttlSeconds: number): Promise<string>;
}

export async function getDocumentDownloadUrl(
  promoterId: string,
  documentId: string,
  storage: StorageAdapter,
  deps: ServiceDeps,
): Promise<{ url: string; fileName: string; mimeType: string; expiresAt: string }> {
  const db = deps.db as unknown as KycAdminDB;

  const [doc] = await db.query<{
    id: string;
    promoter_id: string;
    storage_key: string;
    file_name: string;
    mime_type: string;
  }>(
    `SELECT id, promoter_id, storage_key, file_name, mime_type
     FROM platform.kyc_documents
     WHERE id = $1 AND promoter_id = $2`,
    [documentId, promoterId],
  );

  if (!doc) {
    throw new OnboardingError('DOCUMENT_NOT_FOUND');
  }

  const TTL_SECONDS = 15 * 60; // 15 minut — dokument se musí stáhnout rychle
  const url = await storage.getSignedDownloadUrl(doc.storage_key, TTL_SECONDS);
  const expiresAt = new Date(Date.now() + TTL_SECONDS * 1000).toISOString();

  return {
    url,
    fileName: doc.file_name,
    mimeType: doc.mime_type,
    expiresAt,
  };
}
