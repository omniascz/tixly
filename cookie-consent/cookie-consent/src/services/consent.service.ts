import type { ServiceDeps } from '../lib/service-container.js';
import { ConsentError } from '../lib/consent-errors.js';
import type {
  BannerConfig,
  ConsentRecord,
  CookieCategory,
  RecordConsentInput,
} from '../types/consent.js';

/** One-year expiry (ms) */
const DEFAULT_EXPIRY_MS = 365 * 24 * 60 * 60 * 1000;

export const DEFAULT_BANNER: BannerConfig = {
  promoterId: '',
  title: 'Soubory cookies',
  description:
    'Tato webová stránka používá soubory cookies pro správnou funkčnost a analýzu návštěvnosti. Kliknutím na "Přijmout vše" souhlasíte s jejich použitím.',
  acceptAllLabel: 'Přijmout vše',
  rejectAllLabel: 'Odmítnout',
  customizeLabel: 'Nastavit',
  categories: [
    { key: 'necessary', name: 'Nezbytné', description: 'Nezbytné cookies pro správnou funkci stránky.', required: true, defaultEnabled: true },
    { key: 'functional', name: 'Funkční', description: 'Cookies zlepšující uživatelský komfort.', required: false, defaultEnabled: false },
    { key: 'analytics', name: 'Analytické', description: 'Cookies pro měření návštěvnosti (Google Analytics).', required: false, defaultEnabled: false },
    { key: 'marketing', name: 'Marketingové', description: 'Cookies pro cílení reklamy (Meta Pixel).', required: false, defaultEnabled: false },
  ],
  version: '1.0.0',
  privacyPolicyUrl: '/ochrana-osobnich-udaju',
};

interface BannerRow {
  promoter_id: string;
  config: BannerConfig;
  updated_at: Date;
}

interface ConsentRow {
  id: string;
  promoter_id: string;
  visitor_id: string;
  consents: Record<CookieCategory, boolean>;
  ip_hash: string | null;
  user_agent: string | null;
  banner_version: string;
  consented_at: Date;
  expires_at: Date;
}

function mapConsent(row: ConsentRow): ConsentRecord {
  return {
    id: row.id,
    promoterId: row.promoter_id,
    visitorId: row.visitor_id,
    consents: row.consents,
    ipHash: row.ip_hash,
    userAgent: row.user_agent,
    bannerVersion: row.banner_version,
    consentedAt: row.consented_at,
    expiresAt: row.expires_at,
  };
}

export async function getBannerConfig(
  promoterId: string,
  deps: ServiceDeps,
): Promise<BannerConfig> {
  const rows = await deps.db.query<BannerRow>(
    `SELECT promoter_id, config, updated_at FROM consent.banner_configs
     WHERE promoter_id = $1 LIMIT 1`,
    [promoterId],
  );
  if (rows[0]) {
    return { ...rows[0].config, promoterId };
  }
  return { ...DEFAULT_BANNER, promoterId };
}

export async function setBannerConfig(
  promoterId: string,
  config: Partial<BannerConfig>,
  deps: ServiceDeps,
): Promise<BannerConfig> {
  const current = await getBannerConfig(promoterId, deps);
  const merged: BannerConfig = { ...current, ...config, promoterId };
  await deps.db.execute(
    `INSERT INTO consent.banner_configs (promoter_id, config, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (promoter_id) DO UPDATE
       SET config = EXCLUDED.config, updated_at = NOW()`,
    [promoterId, JSON.stringify(merged)],
  );
  return merged;
}

function validateConsents(
  consents: Partial<Record<CookieCategory, boolean>>,
): Record<CookieCategory, boolean> {
  if (!consents || typeof consents !== 'object') {
    throw new ConsentError('INVALID_CONSENT');
  }
  return {
    necessary: true, // always required
    functional: consents.functional === true,
    analytics: consents.analytics === true,
    marketing: consents.marketing === true,
  };
}

export async function recordConsent(
  input: RecordConsentInput,
  deps: ServiceDeps,
): Promise<ConsentRecord> {
  if (!input.promoterId || !input.visitorId || !input.bannerVersion) {
    throw new ConsentError('INVALID_CONSENT');
  }
  const normalized = validateConsents(input.consents);
  const expiresAt = new Date(Date.now() + DEFAULT_EXPIRY_MS);
  const rows = await deps.db.query<ConsentRow>(
    `INSERT INTO consent.records
       (promoter_id, visitor_id, consents, ip_hash, user_agent, banner_version, consented_at, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7)
     RETURNING *`,
    [
      input.promoterId,
      input.visitorId,
      JSON.stringify(normalized),
      input.ipHash ?? null,
      input.userAgent ?? null,
      input.bannerVersion,
      expiresAt,
    ],
  );
  if (!rows[0]) throw new ConsentError('INVALID_CONSENT');
  return mapConsent(rows[0]);
}

export async function getConsent(
  visitorId: string,
  promoterId: string,
  deps: ServiceDeps,
): Promise<ConsentRecord | null> {
  const rows = await deps.db.query<ConsentRow>(
    `SELECT * FROM consent.records
     WHERE visitor_id = $1 AND promoter_id = $2
     ORDER BY consented_at DESC
     LIMIT 1`,
    [visitorId, promoterId],
  );
  return rows[0] ? mapConsent(rows[0]) : null;
}

export async function isConsentValid(
  visitorId: string,
  promoterId: string,
  deps: ServiceDeps,
): Promise<boolean> {
  const record = await getConsent(visitorId, promoterId, deps);
  if (!record) return false;
  if (record.expiresAt.getTime() <= Date.now()) return false;
  const banner = await getBannerConfig(promoterId, deps);
  return record.bannerVersion === banner.version;
}
