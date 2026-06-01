/**
 * GET/PATCH /api/admin/events/[id]/resale-policy
 *
 * Per-event resale settings (policy, deadline window, fee, payout delay).
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsPromoter, runAsPromoterNonStaff } from '@/lib/admin-auth';
import { z } from 'zod';


const patchSchema = z.object({
  resalePolicy: z.enum(['enabled', 'disabled', 'restricted']).optional(),
  resaleWindowHoursBefore: z.number().int().min(0).max(720).optional(), // max 30 dní
  resaleFeePct: z.number().min(0).max(50).optional(),
  resaleSellerPayoutDelayDays: z.number().int().min(0).max(30).optional(),
  resaleComboExcluded: z.boolean().optional(),
});

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return runAsPromoter(req, async (promoter) => {
  const { id: eventId } = await params;

  const r = await db().query<{
    resale_policy: string;
    resale_window_hours_before: number;
    resale_fee_pct: number;
    resale_seller_payout_delay_days: number;
    resale_combo_excluded: boolean;
  }>(
    `SELECT resale_policy, resale_window_hours_before, resale_fee_pct,
            resale_seller_payout_delay_days, resale_combo_excluded
       FROM catalog.events
      WHERE id = $1 AND promoter_id = $2`,
    [eventId, promoter.promoterId],
  );
  if (r.rows.length === 0) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });

  // Stats: aktivní listings + sold + total payouts
  const stats = await db().query<{
    active_listings: string;
    sold_listings: string;
    total_payouts_halire: string;
  }>(
    `SELECT
        COUNT(*) FILTER (WHERE rl.status = 'active')::text AS active_listings,
        COUNT(*) FILTER (WHERE rl.status = 'sold')::text AS sold_listings,
        COALESCE(SUM(sp.payout_halire) FILTER (WHERE sp.status IN ('pending','eligible','paid')), 0)::text
          AS total_payouts_halire
       FROM resale.resale_listings rl
       JOIN tickets.tickets t ON t.id = rl.ticket_id
       JOIN orders.orders o ON o.id = t.order_id
  LEFT JOIN resale.seller_payouts sp ON sp.listing_id = rl.id
      WHERE o.event_id = $1`,
    [eventId],
  );

  return NextResponse.json({
    policy: r.rows[0],
    stats: {
      activeListings: Number(stats.rows[0]?.active_listings ?? 0),
      soldListings: Number(stats.rows[0]?.sold_listings ?? 0),
      totalPayoutsHalire: Number(stats.rows[0]?.total_payouts_halire ?? 0),
    },
  });

  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return runAsPromoterNonStaff(req, async (promoter) => {
  const { id: eventId } = await params;

  const body: unknown = await req.json().catch(() => ({}));
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'INVALID_BODY' }, { status: 422 });
  }

  const updates: string[] = [];
  const args: unknown[] = [eventId, promoter.promoterId];
  function add(col: string, val: unknown) {
    args.push(val);
    updates.push(`${col} = $${args.length}`);
  }
  if (parsed.data.resalePolicy !== undefined) add('resale_policy', parsed.data.resalePolicy);
  if (parsed.data.resaleWindowHoursBefore !== undefined) add('resale_window_hours_before', parsed.data.resaleWindowHoursBefore);
  if (parsed.data.resaleFeePct !== undefined) add('resale_fee_pct', parsed.data.resaleFeePct);
  if (parsed.data.resaleSellerPayoutDelayDays !== undefined) add('resale_seller_payout_delay_days', parsed.data.resaleSellerPayoutDelayDays);
  if (parsed.data.resaleComboExcluded !== undefined) add('resale_combo_excluded', parsed.data.resaleComboExcluded);

  if (updates.length === 0) return NextResponse.json({ ok: true, noop: true });

  const r = await db().query(
    `UPDATE catalog.events SET ${updates.join(', ')}
      WHERE id = $1 AND promoter_id = $2
    RETURNING id`,
    args,
  );
  if (r.rows.length === 0) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  return NextResponse.json({ ok: true });

  });
}
