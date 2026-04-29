import { NextRequest, NextResponse } from 'next/server';
import { createLink, getUserLinks } from '../../../../services/referral-link.service';
import { buildReferralUrl } from '../../../../lib/referral-code';
import type { CreateLinkOptions } from '../../../../types/referral.types';
import { ReferralCodeCollisionError } from '../../../../types/referral.types';
import { getServiceDeps } from '../../../../lib/service-container.js';

// ============================================================
// GET  /api/referral/links  — list authenticated user's links
// POST /api/referral/links  — create a new referral link
// ============================================================

// Injected via middleware / app bootstrap in production.
// For Next.js App Router the db adapter is obtained from a shared module.
/**
 * Extract the authenticated user ID from the request.
 * Assumes the JWT middleware sets X-User-Id header after validation.
 */
function getUserId(req: NextRequest): string | null {
  return req.headers.get('x-user-id');
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const userId = getUserId(req);
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { db, baseUrl } = getServiceDeps();
    const links = await getUserLinks(userId, db);

    const payload = links.map((link) => ({
      id: link.id,
      code: link.code,
      campaignId: link.campaignId,
      url: buildReferralUrl(link.code, baseUrl, link.campaignId ?? undefined),
      isActive: link.isActive,
      createdAt: link.createdAt.toISOString(),
      stats: {
        totalClicks: link.totalClicks,
        totalConversions: link.totalConversions,
        totalEarnedHalire: link.totalEarnedHalire,
      },
    }));

    return NextResponse.json({ links: payload });
  } catch (err) {
    console.error('[GET /api/referral/links]', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const userId = getUserId(req);
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { campaignId?: string } = {};
  try {
    body = await req.json();
  } catch {
    // No body or invalid JSON — proceed with empty options
  }

  const options: CreateLinkOptions = {};
  if (typeof body.campaignId === 'string' && body.campaignId.length > 0) {
    options.campaignId = body.campaignId;
  }

  try {
    const { db, baseUrl } = getServiceDeps();
    const link = await createLink(userId, options, db);

    return NextResponse.json(
      {
        id: link.id,
        code: link.code,
        url: buildReferralUrl(link.code, baseUrl, link.campaignId ?? undefined),
        campaignId: link.campaignId,
        createdAt: link.createdAt.toISOString(),
      },
      { status: 201 },
    );
  } catch (err) {
    if (err instanceof ReferralCodeCollisionError) {
      return NextResponse.json(
        { error: 'Could not generate a unique referral code. Please retry.' },
        { status: 503 },
      );
    }
    console.error('[POST /api/referral/links]', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
