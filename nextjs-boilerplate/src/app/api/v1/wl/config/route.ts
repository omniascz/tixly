/**
 * GET /api/v1/wl/config
 *
 * Returns brand configuration for the authenticated white-label tenant.
 * Used by WL partner's frontend to apply their branding.
 *
 * Auth: Bearer wl_live_* or wl_test_*
 *
 * Response:
 * {
 *   name, slug, brandColor, logoUrl, supportEmail, supportUrl,
 *   poweredBy: 'Tixly',
 *   apiVersion: 'v1'
 * }
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyWlToken, wlResponseHeaders } from '@/lib/whitelabel/tenant-auth';

export const dynamic = 'force-dynamic';

export async function OPTIONS(): Promise<Response> {
  return new Response(null, { status: 204, headers: wlResponseHeaders() });
}

export async function GET(req: NextRequest): Promise<Response> {
  const tenant = await verifyWlToken(req);
  if (!tenant) {
    return NextResponse.json(
      { error: 'UNAUTHORIZED', message: 'Valid WL Bearer token required (wl_test_* or wl_live_*)' },
      { status: 401, headers: wlResponseHeaders() },
    );
  }

  return NextResponse.json(
    {
      name:         tenant.name,
      slug:         tenant.slug,
      brandColor:   tenant.brandColor,
      logoUrl:      tenant.logoUrl,
      supportEmail: tenant.supportEmail,
      supportUrl:   tenant.supportUrl,
      poweredBy:    'Tixly',
      apiVersion:   'v1',
    },
    { headers: wlResponseHeaders(tenant) },
  );
}
