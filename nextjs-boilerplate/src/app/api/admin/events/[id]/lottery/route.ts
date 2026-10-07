import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsActivePromoter } from '@/lib/admin-auth';
import { z } from 'zod';

const postSchema = z.object({
  ticketTypeId: z.string().uuid().optional(),
  maxWinners: z.number().int().min(1),
  registrationOpens: z.string().datetime().optional(),
  registrationCloses: z.string().datetime(),
  drawAt: z.string().datetime(),
  paymentWindowHours: z.number().int().min(1).max(720).default(48),
});

const patchSchema = z.object({
  campaignId: z.string().uuid(),
  status: z.enum(['open', 'closed']).optional(),
  maxWinners: z.number().int().min(1).optional(),
  paymentWindowHours: z.number().int().min(1).max(720).optional(),
});

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }): Promise<Response> {
  const params = await props.params;
  return runAsActivePromoter(req, async (promoter) => {
    const owns = await db().query(
      `SELECT 1 FROM catalog.events WHERE id = $1 AND promoter_id = $2`,
      [params.id, promoter.promoterId],
    );
    if (owns.rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const r = await db().query<{
      id: string;
      event_id: string;
      ticket_type_id: string | null;
      ticket_type_name: string | null;
      status: string;
      max_winners: number;
      registration_opens: string | null;
      registration_closes: string;
      draw_at: string;
      payment_window_hours: number;
      entry_count: number;
      winner_count: number | null;
      drawn_at: string | null;
      created_at: string;
    }>(
      `SELECT lc.id, lc.event_id, lc.ticket_type_id,
              tt.name AS ticket_type_name,
              lc.status, lc.max_winners, lc.registration_opens, lc.registration_closes,
              lc.draw_at, lc.payment_window_hours, lc.entry_count, lc.winner_count,
              lc.drawn_at, lc.created_at,
              (SELECT COUNT(*) FROM orders.lottery_entries WHERE campaign_id = lc.id) AS entry_count
       FROM orders.lottery_campaigns lc
       LEFT JOIN catalog.ticket_types tt ON tt.id = lc.ticket_type_id
       WHERE lc.event_id = $1
       ORDER BY lc.created_at DESC`,
      [params.id],
    );

    const campaigns = r.rows;
    const result = await Promise.all(
      campaigns.map(async (c) => {
        const entries = await db().query<{
          id: string;
          email: string;
          name: string | null;
          status: string;
          payment_deadline: string | null;
          order_id: string | null;
          created_at: string;
        }>(
          `SELECT id, email, name, status, payment_deadline, order_id, created_at
           FROM orders.lottery_entries
           WHERE campaign_id = $1
           ORDER BY created_at ASC`,
          [c.id],
        );
        return { ...c, entries: entries.rows };
      }),
    );

    return NextResponse.json({ campaigns: result });
  });
}

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }): Promise<Response> {
  const params = await props.params;
  return runAsActivePromoter(req, async (promoter) => {
    const body: unknown = await req.json().catch(() => ({}));
    const parsed = postSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', issues: parsed.error.issues },
        { status: 422 },
      );
    }

    const owns = await db().query(
      `SELECT 1 FROM catalog.events WHERE id = $1 AND promoter_id = $2`,
      [params.id, promoter.promoterId],
    );
    if (owns.rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    if (parsed.data.ticketTypeId) {
      const ttCheck = await db().query(
        `SELECT 1 FROM catalog.ticket_types WHERE id = $1 AND event_id = $2`,
        [parsed.data.ticketTypeId, params.id],
      );
      if (ttCheck.rows.length === 0) {
        return NextResponse.json({ error: 'TICKET_TYPE_NOT_FOUND' }, { status: 422 });
      }
    }

    const r = await db().query<{ id: string }>(
      // `promoter_id` je na orders.lottery_campaigns NOT NULL bez defaultu
      // a INSERT ho neuváděl → 23502 → 500 při každém založení losování.
      // Ověřeno reálným během proti klonu.
      `INSERT INTO orders.lottery_campaigns
         (event_id, promoter_id, ticket_type_id, max_winners, registration_opens,
          registration_closes, draw_at, payment_window_hours, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'draft')
       RETURNING id`,
      [
        params.id,
        promoter.promoterId,
        parsed.data.ticketTypeId ?? null,
        parsed.data.maxWinners,
        parsed.data.registrationOpens ?? null,
        parsed.data.registrationCloses,
        parsed.data.drawAt,
        parsed.data.paymentWindowHours,
      ],
    );

    const campaign = await db().query(
      `SELECT lc.*, tt.name AS ticket_type_name
       FROM orders.lottery_campaigns lc
       LEFT JOIN catalog.ticket_types tt ON tt.id = lc.ticket_type_id
       WHERE lc.id = $1`,
      [r.rows[0].id],
    );

    return NextResponse.json({ campaign: campaign.rows[0] }, { status: 201 });
  });
}

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }): Promise<Response> {
  const params = await props.params;
  return runAsActivePromoter(req, async (promoter) => {
    const body: unknown = await req.json().catch(() => ({}));
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', issues: parsed.error.issues },
        { status: 422 },
      );
    }

    const owns = await db().query(
      `SELECT 1 FROM catalog.events WHERE id = $1 AND promoter_id = $2`,
      [params.id, promoter.promoterId],
    );
    if (owns.rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const campaign = await db().query<{ id: string; status: string }>(
      `SELECT id, status FROM orders.lottery_campaigns WHERE id = $1 AND event_id = $2`,
      [parsed.data.campaignId, params.id],
    );
    if (campaign.rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    if (campaign.rows[0].status === 'drawn' || campaign.rows[0].status === 'completed') {
      return NextResponse.json(
        { error: 'CAMPAIGN_FINALIZED', message: 'Kampaň je již finalizována.' },
        { status: 409 },
      );
    }

    const updates: string[] = ['updated_at = NOW()'];
    const values: unknown[] = [];
    let idx = 1;

    if (parsed.data.status) {
      updates.push(`status = $${idx++}`);
      values.push(parsed.data.status);
    }
    if (parsed.data.maxWinners !== undefined) {
      updates.push(`max_winners = $${idx++}`);
      values.push(parsed.data.maxWinners);
    }
    if (parsed.data.paymentWindowHours !== undefined) {
      updates.push(`payment_window_hours = $${idx++}`);
      values.push(parsed.data.paymentWindowHours);
    }

    values.push(parsed.data.campaignId);
    const updated = await db().query(
      `UPDATE orders.lottery_campaigns SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`,
      values,
    );

    return NextResponse.json({ campaign: updated.rows[0] });
  });
}
