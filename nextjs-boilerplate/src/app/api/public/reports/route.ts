/**
 * POST /api/public/reports — DSA Art. 16 notice mechanism
 *
 * Body: { eventId?, promoterId?, reportedUrl?, category, reason, reporterEmail? }
 *
 * Veřejný endpoint (bez auth). Rate-limit 5/24h per IP.
 * Logged user dostane reporter_user_id; anonymní jen IP + UA.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit/per-tenant';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';

const schema = z.object({
  eventId: z.string().uuid().optional(),
  promoterId: z.string().uuid().optional(),
  reportedUrl: z.string().url().max(1000).optional(),
  category: z.enum([
    'illegal_content',
    'extremism',
    'hate_speech',
    'scam',
    'copyright',
    'impersonation',
    'inappropriate',
    'spam',
    'fake_event',
    'safety',
    'other',
  ]),
  reason: z.string().min(10).max(5000),
  reporterEmail: z.string().email().max(320).optional(),
});

function getClientIp(req: NextRequest): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    'unknown'
  );
}

// Urgentní kategorie → priority='urgent', master admin notif okamžitě
const URGENT_CATEGORIES = new Set(['extremism', 'hate_speech', 'illegal_content', 'safety']);

export async function POST(req: NextRequest): Promise<Response> {
  const ip = getClientIp(req);

  // Rate limit per IP
  const rl = checkRateLimit(`dsa-report:${ip}`, { limit: 5, windowMs: 24 * 60 * 60 * 1000 });
  const rlResp = rateLimitResponse(rl, 'dsa-report');
  if (rlResp) return rlResp;

  const body: unknown = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'BAD_INPUT', issues: parsed.error.issues },
      { status: 422 },
    );
  }
  const input = parsed.data;

  if (!input.eventId && !input.promoterId && !input.reportedUrl) {
    return NextResponse.json(
      { error: 'MISSING_TARGET', message: 'Musíš vyplnit alespoň eventId, promoterId nebo URL.' },
      { status: 422 },
    );
  }

  // Optional: user id z auth header
  const reporterUserId = req.headers.get('x-user-id');

  const priority = URGENT_CATEGORIES.has(input.category) ? 'urgent' : 'normal';

  try {
    // Anonymní reporter možný (bez x-user-id) → service kontext pro INSERT.
    const r = await runWithServiceContext(() =>
      db().query<{ id: string }>(
        `INSERT INTO audit.content_reports
           (event_id, promoter_id, reported_url, category, reason,
            reporter_user_id, reporter_email, reporter_ip, reporter_ua,
            priority)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING id`,
        [
          input.eventId ?? null,
          input.promoterId ?? null,
          input.reportedUrl ?? null,
          input.category,
          input.reason,
          reporterUserId ?? null,
          input.reporterEmail ?? null,
          ip,
          req.headers.get('user-agent')?.slice(0, 500) ?? null,
          priority,
        ],
      ),
    );

    return NextResponse.json(
      {
        ok: true,
        reportId: r.rows[0].id,
        priority,
        message:
          priority === 'urgent'
            ? 'Děkujeme za nahlášení. Urgentní obsah řešíme okamžitě.'
            : 'Děkujeme za nahlášení. Vyřídíme do 7 dní (per DSA Art. 16).',
      },
      { status: 201 },
    );
  } catch (err) {
    console.error('[dsa-report] insert failed:', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}
