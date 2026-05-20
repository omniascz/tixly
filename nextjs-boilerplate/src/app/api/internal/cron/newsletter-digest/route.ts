/**
 * POST /api/internal/cron/newsletter-digest
 *
 * Týdenní email digest pro followery promotéra:
 * - Pro každého promotéra s confirmed subscribers
 * - Vezmi top 5 upcoming events (next 14 dní) podle date_start ASC
 * - Vyrenderuj HTML email + send přes mailer
 * - Označí ns.last_digest_sent_at pro idempotency (1× týdně max)
 *
 * Cron: každé pondělí 09:00 (vercel.json).
 *
 * Auth: x-internal-token.
 */
import { timingSafeEqual } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { sendMail } from '@/lib/email/mailer';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

interface DigestRow {
  email: string;
  promoter_id: string;
  promoter_name: string;
  promoter_slug: string | null;
  brand_color_hex: string | null;
}

interface EventRow {
  id: string;
  title: string;
  slug: string | null;
  date_start: string;
  venue_name: string | null;
  city: string | null;
  min_price_halire: number | null;
  cover_image: string | null;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('cs-CZ', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatPrice(halire: number | null): string {
  if (halire === null) return '';
  return `od ${Math.round(halire / 100).toLocaleString('cs-CZ')} Kč`;
}

function renderDigestHtml(args: {
  promoterName: string;
  promoterSlug: string | null;
  brandColor: string;
  events: EventRow[];
  appUrl: string;
}): string {
  const { promoterName, promoterSlug, brandColor, events, appUrl } = args;
  const promoterUrl = promoterSlug ? `${appUrl}/cs/p/${promoterSlug}` : appUrl;

  return `<!DOCTYPE html>
<html lang="cs">
<head><meta charset="utf-8"><title>${escapeHtml(promoterName)} — co tě čeká</title></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif;background:#f5f5f5;">
  <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f5f5f5;padding:20px 0;">
    <tr><td align="center">
      <table cellpadding="0" cellspacing="0" border="0" width="600" style="background:#fff;border-radius:8px;overflow:hidden;">
        <tr><td style="background:${brandColor};padding:20px 24px;color:#fff;">
          <h1 style="margin:0;font-size:22px;font-weight:700;">${escapeHtml(promoterName)}</h1>
          <p style="margin:4px 0 0;font-size:13px;opacity:0.9;">Tipy na příští 2 týdny</p>
        </td></tr>
        <tr><td style="padding:24px;">
          ${events.map((ev) => `
          <table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-bottom:16px;border-bottom:1px solid #eee;padding-bottom:16px;">
            <tr>
              <td style="vertical-align:top;">
                <a href="${appUrl}/cs/events/${ev.slug ?? ev.id}" style="color:#111;text-decoration:none;">
                  <p style="margin:0;font-size:11px;text-transform:uppercase;color:#888;letter-spacing:0.4px;">${formatDate(ev.date_start)}</p>
                  <h2 style="margin:4px 0;font-size:16px;color:#111;">${escapeHtml(ev.title)}</h2>
                  ${ev.venue_name ? `<p style="margin:4px 0;font-size:13px;color:#666;">${escapeHtml(ev.venue_name)}${ev.city ? `, ${escapeHtml(ev.city)}` : ''}</p>` : ''}
                  ${ev.min_price_halire !== null ? `<p style="margin:6px 0 0;font-size:13px;color:${brandColor};font-weight:600;">${formatPrice(ev.min_price_halire)}</p>` : ''}
                </a>
                <a href="${appUrl}/cs/events/${ev.slug ?? ev.id}" style="display:inline-block;margin-top:8px;background:${brandColor};color:#fff;padding:6px 14px;border-radius:4px;font-size:12px;text-decoration:none;">Koupit lístek</a>
              </td>
            </tr>
          </table>
          `).join('')}
        </td></tr>
        <tr><td style="padding:16px 24px;background:#fafafa;text-align:center;font-size:11px;color:#888;">
          <p style="margin:0;">Dostáváš tento email, protože sleduješ <a href="${promoterUrl}" style="color:${brandColor};">${escapeHtml(promoterName)}</a> na Tixly.</p>
          <p style="margin:8px 0 0;"><a href="${appUrl}/cs/unsubscribe" style="color:#888;">Odhlásit odběr</a> · <a href="${appUrl}" style="color:#888;">Tixly</a></p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

export async function POST(req: NextRequest): Promise<Response> {
  const token = req.headers.get('x-internal-token') ?? '';
  const expected = process.env.INTERNAL_SERVICE_TOKEN ?? '';
  if (!expected || !safeEqual(token, expected)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

  // Najdi subscribers co nedostali digest > 6 dní (idempotency)
  let subscribers: DigestRow[];
  try {
    const r = await db().query<DigestRow>(
      `SELECT ns.email, ns.promoter_id,
              p.name AS promoter_name, p.slug AS promoter_slug, p.brand_color_hex
         FROM marketing.newsletter_subscribers ns
         JOIN platform.promoters p ON p.id = ns.promoter_id
        WHERE ns.status = 'confirmed'
          AND ns.confirmed_at IS NOT NULL
          AND (ns.last_digest_sent_at IS NULL
               OR ns.last_digest_sent_at < NOW() - INTERVAL '6 days')
        LIMIT 5000`,
    );
    subscribers = r.rows;
  } catch (err) {
    // last_digest_sent_at column nemusí existovat — log warn, skip
    console.warn('[newsletter-digest] skip:', err);
    return NextResponse.json({ ok: true, skipped: true, sent: 0 });
  }

  // Group by promoter (1 SQL pro events per promoter)
  const byPromoter = new Map<string, { promoter: DigestRow; emails: string[] }>();
  for (const sub of subscribers) {
    const cached = byPromoter.get(sub.promoter_id);
    if (cached) {
      cached.emails.push(sub.email);
    } else {
      byPromoter.set(sub.promoter_id, { promoter: sub, emails: [sub.email] });
    }
  }

  let totalSent = 0;
  let totalFailed = 0;

  for (const { promoter, emails } of byPromoter.values()) {
    // Load top 5 upcoming events
    const eventsRes = await db().query<EventRow>(
      `SELECT e.id, e.title, e.slug, e.date_start::text, e.cover_image_url AS cover_image,
              v.name AS venue_name, v.city,
              (SELECT MIN(base_price) FROM catalog.ticket_types
                WHERE event_id = e.id AND visibility = 'public') AS min_price_halire
         FROM catalog.events e
         LEFT JOIN catalog.venues v ON v.id = e.venue_id
        WHERE e.promoter_id = $1
          AND e.status = 'published'
          AND e.date_start BETWEEN NOW() AND NOW() + INTERVAL '14 days'
        ORDER BY e.date_start ASC
        LIMIT 5`,
      [promoter.promoter_id],
    );
    if (eventsRes.rows.length === 0) continue; // Nemá smysl posílat prázdný digest

    const brandColor =
      promoter.brand_color_hex && /^#[0-9a-f]{6}$/i.test(promoter.brand_color_hex)
        ? promoter.brand_color_hex
        : '#10b981';

    const html = renderDigestHtml({
      promoterName: promoter.promoter_name,
      promoterSlug: promoter.promoter_slug,
      brandColor,
      events: eventsRes.rows,
      appUrl,
    });
    const subject = `${promoter.promoter_name}: ${eventsRes.rows.length === 1 ? 'připravujeme akci' : `${eventsRes.rows.length} akcí v 14 dnech`}`;

    for (const email of emails) {
      try {
        await sendMail({ to: email, subject, html });
        await db().query(
          `UPDATE marketing.newsletter_subscribers
              SET last_digest_sent_at = NOW()
            WHERE email = $1 AND promoter_id = $2`,
          [email, promoter.promoter_id],
        );
        totalSent += 1;
      } catch (err) {
        console.error('[newsletter-digest] mail failed:', email, err);
        totalFailed += 1;
      }
    }
  }

  return NextResponse.json({
    ok: true,
    promoters: byPromoter.size,
    sent: totalSent,
    failed: totalFailed,
  });
}
