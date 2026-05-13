import { NextRequest, NextResponse } from 'next/server';
import { trackClick } from '../../../../services/click-tracking.service';
import { getLinkByCode } from '../../../../services/referral-link.service';
import { buildReferralUrl, isValidReferralCode } from '../../../../lib/referral-code';
import { LinkNotFoundError } from '../../../../types/referral.types';
import { getServiceDeps } from '../../../../lib/service-container.js';

// ============================================================
// POST /api/referral/track — record a referral link click
//
// Public endpoint — no authentication required.
// Rate limit: 30 req/min per IP (enforced by edge middleware / gateway).
// ============================================================

interface TrackBody {
  code: string;
  visitorId: string;
  sessionId: string;
}

function getClientIp(req: NextRequest): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0].trim() ??
    req.headers.get('x-real-ip') ??
    '0.0.0.0'
  );
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: Partial<TrackBody>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { code, visitorId, sessionId } = body;

  // Validate required fields
  if (typeof code !== 'string' || !isValidReferralCode(code)) {
    return NextResponse.json(
      { error: 'Invalid or missing referral code' },
      { status: 400 },
    );
  }
  if (typeof visitorId !== 'string' || visitorId.length === 0) {
    return NextResponse.json(
      { error: 'Missing visitorId' },
      { status: 400 },
    );
  }
  if (typeof sessionId !== 'string' || sessionId.length === 0) {
    return NextResponse.json(
      { error: 'Missing sessionId' },
      { status: 400 },
    );
  }

  const ip = getClientIp(req);
  const userAgent = req.headers.get('user-agent') ?? 'unknown';

  try {
    const { db, baseUrl: _baseUrl } = getServiceDeps();

    const click = await trackClick(
      { code, visitorId, sessionId, ip, userAgent },
      db,
    );

    // Resolve the link to build the redirect URL
    const link = await getLinkByCode(code, db);
    const baseUrl = _baseUrl;
    const redirectUrl = link
      ? buildReferralUrl(code, baseUrl, link.campaignId ?? undefined)
      : `${baseUrl}/`;

    return NextResponse.json({
      linkId: click.linkId,
      redirectUrl,
    });
  } catch (err) {
    if (err instanceof LinkNotFoundError) {
      return NextResponse.json(
        { error: 'Referral link not found or inactive' },
        { status: 404 },
      );
    }
    console.error('[POST /api/referral/track]', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
