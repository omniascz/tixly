/**
 * GET /api/events/[id]/modular-pass
 *
 * Public — vrátí modular pass config pro tento event:
 *   - ticket_type (musí mít row v catalog.ticket_modular_pricing)
 *   - dostupné dny + zóny pro buyer výběr
 *   - pricing increments
 *
 * Pokud event nemá modular pass enabled, vrátí 404.
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';


export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) {
    return NextResponse.json({ error: 'INVALID_ID' }, { status: 400 });
  }

  const tt = await db().query<{
    id: string;
    name: string;
    base_price: number;
    per_day_price_minor: number;
    per_zone_surcharge_minor: number;
    min_days: number;
    max_days: number | null;
    min_zones: number;
    max_zones: number | null;
  }>(
    `SELECT tt.id, tt.name, tt.base_price,
            mp.per_day_price_minor, mp.per_zone_surcharge_minor,
            mp.min_days, mp.max_days, mp.min_zones, mp.max_zones
       FROM catalog.ticket_types tt
       JOIN catalog.ticket_modular_pricing mp ON mp.ticket_type_id = tt.id
      WHERE tt.event_id = $1
      ORDER BY tt.base_price
      LIMIT 1`,
    [params.id],
  );
  if (tt.rows.length === 0) {
    return NextResponse.json(
      { error: 'NO_MODULAR_PASS', message: 'Tento event nenabízí modular pass.' },
      { status: 404 },
    );
  }

  const days = await db().query<{
    id: string;
    day_index: number;
    label: string | null;
    starts_at: string;
  }>(
    `SELECT id, day_index, label, starts_at::text
       FROM catalog.event_days WHERE event_id = $1
      ORDER BY day_index`,
    [params.id],
  );

  const zones = await db().query<{
    id: string;
    name: string;
    zone_type: string;
    description: string | null;
  }>(
    `SELECT id, name, zone_type, description
       FROM catalog.event_zones WHERE event_id = $1
      ORDER BY display_order, name`,
    [params.id],
  );

  return NextResponse.json({
    ticketType: tt.rows[0],
    days: days.rows,
    zones: zones.rows,
  });
}
