/**
 * GET /api/events/[id]/ticket-types — public list ticket types pro akci
 * + flex pass info (jaký typ pass, kolik picks)
 */

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

interface TtRow {
  id: string;
  name: string;
  base_price: number;
  remaining_qty: number;
  picks_required: number | null;
  pass_kind: string | null;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) {
    return NextResponse.json({ ticketTypes: [] });
  }
  const r = await db().query<TtRow>(
    `SELECT tt.id, tt.name, tt.base_price, tt.remaining_qty,
            f.picks_required, f.pass_kind
     FROM catalog.ticket_types tt
     LEFT JOIN catalog.flex_pass_settings f ON f.ticket_type_id = tt.id
     WHERE tt.event_id = $1
     ORDER BY tt.base_price`,
    [params.id],
  );
  return NextResponse.json({
    ticketTypes: r.rows.map((t) => ({
      id: t.id,
      name: t.name,
      basePrice: t.base_price,
      remainingQty: t.remaining_qty,
      passSettings:
        t.pass_kind && t.picks_required
          ? { kind: t.pass_kind, picksRequired: t.picks_required }
          : null,
    })),
  });
}
