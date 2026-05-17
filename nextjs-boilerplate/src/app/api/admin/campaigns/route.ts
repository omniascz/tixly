/**
 * GET  /api/admin/campaigns               — list kampaní promotéra
 * POST /api/admin/campaigns               — vytvořit kampaň (draft)
 */

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { z } from 'zod';
import { requirePromoter } from '@/lib/admin-auth';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

const createSchema = z.object({
  name: z.string().min(2).max(200),
  channel: z.enum(['email', 'sms', 'push', 'inapp']).default('email'),
  subject: z.string().max(200).optional(),
  bodyHtml: z.string().max(50_000).optional(),
  bodyText: z.string().max(20_000).optional(),
  replyTo: z.string().email().optional(),
  utmSource: z.string().max(80).optional(),
  utmMedium: z.string().max(80).optional(),
  utmCampaign: z.string().max(80).optional(),
  segment: z
    .object({
      all_buyers: z.boolean().optional(),
      min_orders: z.number().int().min(1).optional(),
      max_orders: z.number().int().min(1).optional(),
      city: z.string().optional(),
      event_attended: z.string().uuid().optional(),
      last_order_within_days: z.number().int().min(1).optional(),
      last_order_older_than_days: z.number().int().min(1).optional(),
    })
    .default({}),
  scheduledAt: z.string().datetime().optional(),
});

export async function GET(req: NextRequest): Promise<Response> {
  const promoter = await requirePromoter(req);
  if (!promoter) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const r = await db().query<{
    id: string;
    name: string;
    channel: string;
    status: string;
    subject: string | null;
    recipient_count: number;
    sent_count: number;
    open_count: number;
    click_count: number;
    conversion_count: number;
    revenue_halire: number;
    scheduled_at: string | null;
    sent_at: string | null;
    created_at: string;
  }>(
    `SELECT id, name, channel, status, subject,
            recipient_count, sent_count, open_count, click_count, conversion_count,
            revenue_halire, scheduled_at, sent_at, created_at
     FROM marketing.campaigns
     WHERE promoter_id = $1
     ORDER BY created_at DESC
     LIMIT 100`,
    [promoter.promoterId],
  );

  return NextResponse.json({
    items: r.rows.map((row) => ({
      id: row.id,
      name: row.name,
      channel: row.channel,
      status: row.status,
      subject: row.subject,
      recipientCount: row.recipient_count,
      sentCount: row.sent_count,
      openCount: row.open_count,
      clickCount: row.click_count,
      conversionCount: row.conversion_count,
      revenueHalire: row.revenue_halire,
      scheduledAt: row.scheduled_at,
      sentAt: row.sent_at,
      createdAt: row.created_at,
    })),
  });
}

export async function POST(req: NextRequest): Promise<Response> {
  const promoter = await requirePromoter(req);
  if (!promoter || promoter.status !== 'active') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'BAD_INPUT', issues: parsed.error.issues },
      { status: 422 },
    );
  }
  const input = parsed.data;

  // Estimate recipient count pomocí segment matching (preview)
  let recipientCount = 0;
  try {
    const countRes = await db().query<{ count: string }>(
      `SELECT COUNT(DISTINCT o.user_id)::text AS count
       FROM orders.orders o
       JOIN catalog.events e ON e.id = o.event_id
       WHERE e.promoter_id = $1 AND o.status = 'paid'
         ${input.segment.last_order_older_than_days ? `AND o.paid_at < NOW() - INTERVAL '${Number(input.segment.last_order_older_than_days)} days'` : ''}
         ${input.segment.last_order_within_days ? `AND o.paid_at > NOW() - INTERVAL '${Number(input.segment.last_order_within_days)} days'` : ''}`,
      [promoter.promoterId],
    );
    recipientCount = Number(countRes.rows[0]?.count ?? 0);
  } catch {
    recipientCount = 0;
  }

  const ins = await db().query<{ id: string }>(
    `INSERT INTO marketing.campaigns
       (promoter_id, name, channel, subject, body_html, body_text, reply_to,
        utm_source, utm_medium, utm_campaign, segment,
        recipient_count, scheduled_at, status, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7,
             $8, $9, $10, $11::jsonb,
             $12, $13, $14, $15)
     RETURNING id`,
    [
      promoter.promoterId,
      input.name,
      input.channel,
      input.subject ?? null,
      input.bodyHtml ?? null,
      input.bodyText ?? null,
      input.replyTo ?? null,
      input.utmSource ?? null,
      input.utmMedium ?? null,
      input.utmCampaign ?? null,
      JSON.stringify(input.segment),
      recipientCount,
      input.scheduledAt ?? null,
      input.scheduledAt ? 'scheduled' : 'draft',
      promoter.userId,
    ],
  );

  return NextResponse.json(
    {
      ok: true,
      id: ins.rows[0]!.id,
      estimatedRecipients: recipientCount,
    },
    { status: 201 },
  );
}
