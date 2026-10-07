/**
 * GET /api/qr/[slug] — public QR scan tracker
 *
 * Logika:
 *   1. Slug → najdi qr_campaigns row
 *   2. INSERT marketing.qr_scans (analytics detail)
 *   3. UPDATE qr_campaigns SET scan_count = scan_count + 1
 *   4. Set cookie qr_ref={campaign_id} (90 days) pro attribution na checkout
 *   5. Redirect na /cs/events/[event_id] s UTM query params
 *
 * Idempotent z hlediska clienta — každý scan inkrementuje (žádný dedupe).
 * IP je hashed (SHA-256 truncated) pro GDPR compliance.
 */

import { createHash } from 'crypto';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';
import { NextRequest, NextResponse } from 'next/server';


export const dynamic = 'force-dynamic';

function hashIp(ip: string | null): string | null {
  if (!ip) return null;
  return createHash('sha256').update(`${ip}|tixly-qr-salt`).digest('hex').slice(0, 32);
}

export async function GET(req: NextRequest, props: { params: Promise<{ slug: string }> }): Promise<Response> {
  const params = await props.params;
  // Kolo 2 / 3B: veřejný sken QR = systémový zápis (qr_scans pod RLS)
  return runWithServiceContext(async () => {
  const slug = params.slug.toLowerCase();
  if (!/^[a-z0-9-]{3,40}$/.test(slug)) {
    return NextResponse.redirect(new URL('/cs/events', req.url), { status: 302 });
  }

  const r = await db().query<{
    id: string;
    event_id: string;
    utm_source: string | null;
    utm_medium: string | null;
    utm_campaign: string | null;
  }>(
    `SELECT id, event_id, utm_source, utm_medium, utm_campaign
     FROM marketing.qr_campaigns WHERE slug = $1`,
    [slug],
  );
  if (r.rows.length === 0) {
    return NextResponse.redirect(new URL('/cs/events', req.url), { status: 302 });
  }
  const campaign = r.rows[0];

  // Fire-and-forget log + counter increment (mimo redirect blocking)
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    null;
  const ipHash = hashIp(ip);
  const ua = req.headers.get('user-agent')?.slice(0, 500) ?? null;
  const referer = req.headers.get('referer')?.slice(0, 500) ?? null;

  void (async () => {
    try {
      await db().query(
        `INSERT INTO marketing.qr_scans (campaign_id, user_agent, ip_hash, referer)
         VALUES ($1, $2, $3, $4)`,
        [campaign.id, ua, ipHash, referer],
      );
      await db().query(
        `UPDATE marketing.qr_campaigns
         SET scan_count = scan_count + 1, updated_at = now()
         WHERE id = $1`,
        [campaign.id],
      );
    } catch (err) {
      console.error('[qr scan tracking]', err);
    }
  })();

  // Redirect na event detail s UTM tagy + cookie pro attribution
  const target = new URL(`/cs/events/${campaign.event_id}`, req.url);
  target.searchParams.set('utm_source', campaign.utm_source ?? 'print');
  target.searchParams.set('utm_medium', campaign.utm_medium ?? 'qr');
  if (campaign.utm_campaign) target.searchParams.set('utm_campaign', campaign.utm_campaign);
  target.searchParams.set('qr_ref', campaign.id);

  const res = NextResponse.redirect(target, { status: 302 });
  res.cookies.set('qr_ref', campaign.id, {
    maxAge: 90 * 24 * 60 * 60, // 90 dní
    sameSite: 'lax',
    httpOnly: false, // čitelné v JS pro checkout client-side attach
    path: '/',
  });
  return res;
  });
}
