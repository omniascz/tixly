/**
 * GET /api/admin/sms-campaigns — list
 * POST /api/admin/sms-campaigns — create + immediate send (mock)
 *
 * Segment: kupci s ≥ minOrders zaplacenými objednávkami,
 *          volitelně filtrováno na konkrétní event.
 *
 * Send běží in-process, sériově (rate limit 5/min). Pro produkci by
 * šlo do Kafka topicu a workeru.
 */

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { z } from 'zod';
import { requirePromoter } from '@/lib/admin-auth';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit/per-tenant';
import { sendSms } from '@/lib/sms/bulkgate-mock';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

interface CampaignRow {
  id: string;
  name: string;
  message_text: string;
  status: string;
  scheduled_at: string | null;
  sent_at: string | null;
  recipients_count: number;
  delivered_count: number;
  failed_count: number;
  segment_event_id: string | null;
  created_at: string;
}

export async function GET(req: NextRequest): Promise<Response> {
  const promoter = await requirePromoter(req);
  if (!promoter) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const r = await db().query<CampaignRow>(
    `SELECT id, name, message_text, status, scheduled_at, sent_at,
            recipients_count, delivered_count, failed_count,
            segment_event_id, created_at
     FROM marketing.sms_campaigns
     WHERE promoter_id = $1
     ORDER BY created_at DESC
     LIMIT 100`,
    [promoter.promoterId],
  );
  return NextResponse.json({
    campaigns: r.rows.map((row) => ({
      id: row.id,
      name: row.name,
      messageText: row.message_text,
      status: row.status,
      scheduledAt: row.scheduled_at,
      sentAt: row.sent_at,
      recipientsCount: row.recipients_count,
      deliveredCount: row.delivered_count,
      failedCount: row.failed_count,
      segmentEventId: row.segment_event_id,
      createdAt: row.created_at,
    })),
  });
}

const createSchema = z.object({
  name: z.string().min(1).max(100),
  messageText: z.string().min(1).max(480),
  segmentEventId: z.string().uuid().nullable().optional(),
  segmentMinOrders: z.number().int().min(1).max(100).default(1),
});

interface RecipientRow {
  user_id: string;
  email: string;
  phone: string;
}

export async function POST(req: NextRequest): Promise<Response> {
  const promoter = await requirePromoter(req);
  if (!promoter || promoter.status !== 'active') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const rl = checkRateLimit(`${promoter.promoterId}:sms-campaign`, {
    limit: 5,
    windowMs: 60_000,
  });
  const rlResp = rateLimitResponse(rl, 'sms-campaign');
  if (rlResp) return rlResp;

  const body = await req.json().catch(() => ({}));
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.issues },
      { status: 422 },
    );
  }
  const input = parsed.data;

  // 1) Resolve recipients — všechny dynamické hodnoty přes parametrizaci
  const params: unknown[] = [promoter.promoterId, input.segmentMinOrders];
  let eventFilter = '';
  if (input.segmentEventId) {
    eventFilter = `AND o.event_id = $3`;
    params.push(input.segmentEventId);
  }

  const recipientsRes = await db().query<RecipientRow>(
    `SELECT DISTINCT u.id AS user_id, u.email, u.phone
     FROM orders.orders o
     JOIN catalog.events e ON e.id = o.event_id
     JOIN identity.users u ON u.id = o.user_id
     WHERE e.promoter_id = $1
       AND o.status = 'paid'
       AND u.phone IS NOT NULL
       ${eventFilter}
     GROUP BY u.id, u.email, u.phone
     HAVING COUNT(o.id) >= $2
     LIMIT 1000`,
    params,
  );

  // 2) Insert campaign as 'sending'
  const campaignRes = await db().query<{ id: string }>(
    `INSERT INTO marketing.sms_campaigns
       (promoter_id, name, message_text, segment_event_id, segment_min_orders,
        status, recipients_count, sent_at)
     VALUES ($1, $2, $3, $4, $5, 'sending', $6, NOW())
     RETURNING id`,
    [
      promoter.promoterId,
      input.name,
      input.messageText,
      input.segmentEventId ?? null,
      input.segmentMinOrders,
      recipientsRes.rows.length,
    ],
  );
  const campaignId = campaignRes.rows[0].id;

  // 3) Send to each (in-process, sériově)
  let delivered = 0;
  let failed = 0;
  for (const r of recipientsRes.rows) {
    const send = await sendSms(
      {
        to: r.phone,
        text: input.messageText,
        promoterId: promoter.promoterId,
      },
      db(),
    );
    if (send.ok) delivered += 1;
    else failed += 1;
  }

  // 4) Update final status
  await db().query(
    `UPDATE marketing.sms_campaigns
     SET status = 'sent', delivered_count = $1, failed_count = $2
     WHERE id = $3`,
    [delivered, failed, campaignId],
  );

  return NextResponse.json({
    id: campaignId,
    recipientsCount: recipientsRes.rows.length,
    deliveredCount: delivered,
    failedCount: failed,
  });
}
