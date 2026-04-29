/**
 * Resolve promoter z host headeru (white-label).
 *
 * Pokud host matchuje verified custom doménu, vrátí promoter info.
 * Default cestu (tixly.cz) → null = no white-label, normální platforma.
 *
 * Cache: 60s in-memory pro performance.
 */

import { Pool } from 'pg';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

export interface WhiteLabelContext {
  promoterId: string;
  promoterSlug: string;
  promoterName: string;
  brandingLogoUrl: string | null;
  brandingPrimaryColor: string | null;
  brandingHidePoweredBy: boolean;
}

interface CacheEntry {
  expires: number;
  value: WhiteLabelContext | null;
}

const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60_000;

export async function resolveWhiteLabel(host: string): Promise<WhiteLabelContext | null> {
  const normalized = host.split(':')[0]!.toLowerCase();
  // Default tixly domains — no white-label
  if (
    normalized === 'localhost' ||
    normalized.endsWith('.tixly.cz') ||
    normalized === 'tixly.cz'
  ) {
    return null;
  }

  const cached = cache.get(normalized);
  if (cached && cached.expires > Date.now()) {
    return cached.value;
  }

  const r = await db().query<{
    promoter_id: string;
    slug: string;
    name: string;
    logo_url: string | null;
    primary_color: string | null;
    hide_powered_by: boolean;
  }>(
    `SELECT pd.promoter_id, p.slug, p.name,
            pb.logo_url, pb.primary_color, pb.hide_powered_by
     FROM platform.promoter_domains pd
     JOIN platform.promoters p ON p.id = pd.promoter_id
     LEFT JOIN platform.promoter_branding pb ON pb.promoter_id = pd.promoter_id
     WHERE LOWER(pd.domain) = $1 AND pd.verified_at IS NOT NULL
       AND p.status = 'active'`,
    [normalized],
  );

  const value =
    r.rows.length === 0
      ? null
      : {
          promoterId: r.rows[0]!.promoter_id,
          promoterSlug: r.rows[0]!.slug,
          promoterName: r.rows[0]!.name,
          brandingLogoUrl: r.rows[0]!.logo_url,
          brandingPrimaryColor: r.rows[0]!.primary_color,
          brandingHidePoweredBy: r.rows[0]!.hide_powered_by ?? false,
        };

  cache.set(normalized, { expires: Date.now() + CACHE_TTL_MS, value });
  return value;
}
