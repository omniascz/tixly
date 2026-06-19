import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsActivePromoter } from '@/lib/admin-auth';
import { z } from 'zod';

interface AnnouncementRow {
  id: string;
  event_id: string;
  subject: string;
  message: string;
  cast_change: string | null;
  offer_exchange: boolean;
  offer_refund: boolean;
  recipient_count: number;
  sent_at: string | null;
  created_at: string;
}

interface ResponseRow {
  response: string;
  count: string;
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  return runAsActivePromoter(req, async (ctx) => {
    const ownerCheck = await db().query<{ id: string }>(
      `SELECT id FROM catalog.events WHERE id = $1 AND promoter_id = $2`,
      [params.id, ctx.promoterId],
    );
    if (ownerCheck.rows.length === 0) {
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    }

    const rows = await db().query<AnnouncementRow>(
      `SELECT id, event_id, subject, message, cast_change, offer_exchange, offer_refund,
              recipient_count, sent_at, created_at
       FROM communications.emergency_announcements
       WHERE event_id = $1
       ORDER BY created_at DESC`,
      [params.id],
    );

    const withResponses = await Promise.all(
      rows.rows.map(async (ann) => {
        const resp = await db().query<ResponseRow>(
          `SELECT response, COUNT(*)::text AS count
           FROM communications.announcement_responses
           WHERE announcement_id = $1
           GROUP BY response`,
          [ann.id],
        );
        const responseSummary: Record<string, number> = {};
        for (const r of resp.rows) {
          responseSummary[r.response] = parseInt(r.count, 10);
        }
        return { ...ann, responses: responseSummary };
      }),
    );

    return NextResponse.json({ announcements: withResponses });
  });
}

const postSchema = z.object({
  subject: z.string().min(1).max(300),
  message: z.string().min(1).max(10000),
  castChange: z.string().max(500).optional(),
  offerExchange: z.boolean().optional(),
  offerRefund: z.boolean().optional(),
});

interface TicketRecipient {
  id: string;
  email: string;
  name: string | null;
  order_id: string;
  user_id: string;
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  return runAsActivePromoter(req, async (ctx) => {
    const body = await req.json().catch(() => ({}));
    const parsed = postSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'VALIDATION_ERROR', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const { subject, message, castChange, offerExchange = true, offerRefund = true } = parsed.data;

    const ownerCheck = await db().query<{ id: string }>(
      `SELECT id FROM catalog.events WHERE id = $1 AND promoter_id = $2`,
      [params.id, ctx.promoterId],
    );
    if (ownerCheck.rows.length === 0) {
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    }

    const annResult = await db().query<{ id: string }>(
      `INSERT INTO communications.emergency_announcements
         (event_id, promoter_id, subject, message, cast_change, offer_exchange, offer_refund)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [params.id, ctx.promoterId, subject, message, castChange ?? null, offerExchange, offerRefund],
    );
    const announcementId = annResult.rows[0].id;

    const tickets = await db().query<TicketRecipient>(
      `SELECT t.id, u.email, u.name, o.id AS order_id, o.user_id
       FROM tickets.tickets t
       JOIN orders.orders o ON o.id = t.order_id
       JOIN identity.users u ON u.id = o.user_id
       WHERE t.event_id = $1 AND t.status = 'valid'`,
      [params.id],
    );

    const recipients = tickets.rows;

    if (recipients.length > 0) {
      const values = recipients
        .map((_, i) => {
          const base = i * 4;
          return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, 'accepted')`;
        })
        .join(', ');

      const flatParams: string[] = [];
      for (const r of recipients) {
        flatParams.push(announcementId, r.id, r.order_id, r.user_id);
      }

      await db().query(
        `INSERT INTO communications.announcement_responses
           (announcement_id, ticket_id, order_id, user_id, response)
         VALUES ${values}
         ON CONFLICT (announcement_id, ticket_id) DO NOTHING`,
        flatParams,
      );
    }

    await db().query(
      `UPDATE communications.emergency_announcements
       SET sent_at = NOW(), recipient_count = $1
       WHERE id = $2`,
      [recipients.length, announcementId],
    );

    for (const r of recipients) {
      console.log(
        `[EMERGENCY] announcementId=${announcementId} to=${r.email} name=${r.name ?? ''} ` +
        `subject="${subject}" castChange=${castChange ?? ''} ` +
        `offerExchange=${offerExchange} offerRefund=${offerRefund}`,
      );
    }

    return NextResponse.json({ announcementId, recipientCount: recipients.length });
  });
}
