/**
 * GET/POST/DELETE /api/admin/events/[id]/channel-prices
 *
 * Channel-based pricing override matrix. Pro každý ticket_type × channel
 * promotér nastaví vlastní cenu (box office obvykle nižší, partner vyšší).
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

const postSchema = z.object({
  ticketTypeId: z.string().uuid(),
  channelKey: z.string().min(2).max(40),
  priceOverride: z.number().int().min(0).max(100_000_000),
  feePctOverride: z.number().min(0).max(50).optional(),
  effectiveFrom: z.string().datetime().optional(),
  effectiveUntil: z.string().datetime().optional(),
});

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const promoter = await requirePromoter(req);
  if (!promoter) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const { id: eventId } = await params;

  const r = await db().query(
    `SELECT ttcp.id, ttcp.ticket_type_id, tt.name AS ticket_type_name,
            ttcp.channel_key, ttcp.price_override, ttcp.fee_pct_override,
            ttcp.effective_from::text, ttcp.effective_until::text,
            tt.base_price AS default_price
       FROM catalog.ticket_type_channel_prices ttcp
       JOIN catalog.ticket_types tt ON tt.id = ttcp.ticket_type_id
       JOIN catalog.events e ON e.id = tt.event_id
      WHERE e.id = $1 AND e.promoter_id = $2
   ORDER BY tt.name, ttcp.channel_key`,
    [eventId, promoter.promoterId],
  );

  const channelsRes = await db().query<{
    channel_key: string; display_name: string;
  }>(
    `SELECT channel_key, display_name FROM catalog.sales_channels
      WHERE (promoter_id IS NULL OR promoter_id = $1) AND is_active = true
   ORDER BY display_name`,
    [promoter.promoterId],
  );

  return NextResponse.json({
    overrides: r.rows,
    availableChannels: channelsRes.rows,
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const promoter = await requirePromoter(req);
  if (!promoter || promoter.role === 'staff') {
    return NextResponse.json({ error: 'ADMIN_OR_OWNER_ONLY' }, { status: 403 });
  }
  const { id: eventId } = await params;

  const body: unknown = await req.json().catch(() => ({}));
  const parsed = postSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'INVALID_BODY' }, { status: 422 });
  }

  // Ownership
  const own = await db().query(
    `SELECT 1 FROM catalog.ticket_types tt
       JOIN catalog.events e ON e.id = tt.event_id
      WHERE tt.id = $1 AND e.id = $2 AND e.promoter_id = $3`,
    [parsed.data.ticketTypeId, eventId, promoter.promoterId],
  );
  if (own.rows.length === 0) {
    return NextResponse.json({ error: 'NOT_OWNER' }, { status: 403 });
  }

  const r = await db().query<{ id: string }>(
    `INSERT INTO catalog.ticket_type_channel_prices
       (ticket_type_id, channel_key, price_override, fee_pct_override,
        effective_from, effective_until)
     VALUES ($1, $2, $3, $4, $5::timestamptz, $6::timestamptz)
     ON CONFLICT (ticket_type_id, channel_key)
     DO UPDATE SET price_override = EXCLUDED.price_override,
                   fee_pct_override = EXCLUDED.fee_pct_override,
                   effective_from = EXCLUDED.effective_from,
                   effective_until = EXCLUDED.effective_until
     RETURNING id`,
    [
      parsed.data.ticketTypeId, parsed.data.channelKey,
      parsed.data.priceOverride, parsed.data.feePctOverride ?? null,
      parsed.data.effectiveFrom ?? null, parsed.data.effectiveUntil ?? null,
    ],
  );

  return NextResponse.json({ id: r.rows[0].id, upserted: true });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const promoter = await requirePromoter(req);
  if (!promoter || promoter.role === 'staff') {
    return NextResponse.json({ error: 'ADMIN_OR_OWNER_ONLY' }, { status: 403 });
  }
  const { id: eventId } = await params;
  const overrideId = new URL(req.url).searchParams.get('overrideId');
  if (!overrideId) return NextResponse.json({ error: 'OVERRIDE_ID_REQUIRED' }, { status: 422 });

  const r = await db().query(
    `DELETE FROM catalog.ticket_type_channel_prices ttcp
      USING catalog.ticket_types tt, catalog.events e
      WHERE ttcp.id = $1
        AND ttcp.ticket_type_id = tt.id
        AND tt.event_id = e.id
        AND e.id = $2 AND e.promoter_id = $3
    RETURNING ttcp.id`,
    [overrideId, eventId, promoter.promoterId],
  );
  if (r.rows.length === 0) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }
  return NextResponse.json({ deleted: true });
}
