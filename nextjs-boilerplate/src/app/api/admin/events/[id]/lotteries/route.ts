/**
 * GET  /api/admin/events/[id]/lotteries — list všech lottery pro event
 * POST /api/admin/events/[id]/lotteries — create new lottery
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsPromoter, runAsActivePromoterOwner } from '@/lib/admin-auth';
import { z } from 'zod';


const createSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).nullable().optional(),
  opensAt: z.string().datetime(),
  closesAt: z.string().datetime(),
  drawAt: z.string().datetime(),
  paymentDeadlineHours: z.number().int().min(1).max(720).default(72),
  maxPerEntry: z.number().int().min(1).max(20).default(4),
  allocationTotal: z.number().int().min(1).max(1_000_000),
});

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  return runAsPromoter(req, async (promoter) => {
  const owns = await db().query(
    `SELECT 1 FROM catalog.events WHERE id = $1 AND promoter_id = $2`,
    [params.id, promoter.promoterId],
  );
  if (owns.rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const r = await db().query<{
    id: string;
    name: string;
    description: string | null;
    opens_at: string;
    closes_at: string;
    draw_at: string;
    status: string;
    allocation_total: number;
    entries_count: number;
    winners_count: number;
  }>(
    `SELECT l.id, l.name, l.description, l.opens_at, l.closes_at, l.draw_at,
            l.status, l.allocation_total,
            (SELECT COUNT(*)::int FROM catalog.lottery_entries WHERE lottery_id = l.id) AS entries_count,
            (SELECT COUNT(*)::int FROM catalog.lottery_entries WHERE lottery_id = l.id AND status = 'winner') AS winners_count
     FROM catalog.event_lotteries l
     WHERE l.event_id = $1
     ORDER BY l.opens_at DESC`,
    [params.id],
  );
  return NextResponse.json({ lotteries: r.rows });

  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  return runAsActivePromoterOwner(req, async (promoter) => {
  const body: unknown = await req.json().catch(() => ({}));
  const parsed = createSchema.safeParse(body);
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

  if (
    new Date(parsed.data.closesAt).getTime() <= new Date(parsed.data.opensAt).getTime() ||
    new Date(parsed.data.drawAt).getTime() < new Date(parsed.data.closesAt).getTime()
  ) {
    return NextResponse.json(
      { error: 'INVALID_DATES', message: 'opens < closes <= draw musí platit.' },
      { status: 422 },
    );
  }

  const r = await db().query<{ id: string }>(
    `INSERT INTO catalog.event_lotteries
       (event_id, name, description, opens_at, closes_at, draw_at,
        payment_deadline_hours, max_per_entry, allocation_total)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id`,
    [
      params.id,
      parsed.data.name,
      parsed.data.description ?? null,
      parsed.data.opensAt,
      parsed.data.closesAt,
      parsed.data.drawAt,
      parsed.data.paymentDeadlineHours,
      parsed.data.maxPerEntry,
      parsed.data.allocationTotal,
    ],
  );
  return NextResponse.json({ id: r.rows[0].id }, { status: 201 });

  });
}
