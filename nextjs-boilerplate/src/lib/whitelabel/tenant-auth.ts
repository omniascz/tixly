/**
 * White-label tenant authentication.
 *
 * WL API key format: `wl_<env>_<hex64>`
 *   wl_test_* — sandbox
 *   wl_live_* — production
 *
 * Keys are SHA-256 hashed before storage (same pattern as b2b.api_keys).
 * Tenant looked up from platform.whitelabel_tenants via key hash.
 */

import { createHash } from 'crypto';
import type { NextRequest } from 'next/server';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';

export interface WlTenantContext {
  tenantId: string;
  name: string;
  slug: string;
  domain: string | null;
  brandColor: string;
  logoUrl: string | null;
  supportEmail: string | null;
  supportUrl: string | null;
  callbackUrl: string | null;
  allowedPromoterIds: string[];
  serviceFeeBps: number;
}

const TOKEN_REGEX = /^wl_(test|live)_[a-f0-9]{32,64}$/;

export async function verifyWlToken(req: NextRequest): Promise<WlTenantContext | null> {
  const header = req.headers.get('authorization');
  if (!header?.startsWith('Bearer ')) return null;
  const token = header.slice(7).trim();
  if (!TOKEN_REGEX.test(token)) return null;

  const keyHash = createHash('sha256').update(token).digest('hex');

  return runWithServiceContext(async () => {
    const res = await db().query<{
      id: string;
      name: string;
      slug: string;
      domain: string | null;
      brand_color: string;
      logo_url: string | null;
      support_email: string | null;
      support_url: string | null;
      callback_url: string | null;
      allowed_promoter_ids: string[];
      service_fee_bps: number;
    }>(
      `SELECT id, name, slug, domain, brand_color, logo_url, support_email,
              support_url, callback_url, allowed_promoter_ids, service_fee_bps
       FROM platform.whitelabel_tenants
       WHERE api_key_hash = $1 AND is_active = TRUE`,
      [keyHash],
    );

    if (res.rows.length === 0) return null;
    const t = res.rows[0];

    return {
      tenantId: t.id,
      name: t.name,
      slug: t.slug,
      domain: t.domain,
      brandColor: t.brand_color,
      logoUrl: t.logo_url,
      supportEmail: t.support_email,
      supportUrl: t.support_url,
      callbackUrl: t.callback_url,
      allowedPromoterIds: t.allowed_promoter_ids ?? [],
      serviceFeeBps: t.service_fee_bps ?? 0,
    };
  });
}

/** CORS headers for WL tenant API responses */
export function wlResponseHeaders(ctx?: WlTenantContext | null): Record<string, string> {
  const origin = ctx?.domain ? `https://${ctx.domain}` : '*';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'X-Tixly-Tenant': ctx?.slug ?? 'unknown',
  };
}
