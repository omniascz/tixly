/**
 * Apple Wallet PassKit Web Service — list updatable passes for device.
 *
 * GET ?passesUpdatedSince=<tag>
 *   Vrátí seznam serialNumbers které mají update od posledního tag.
 *   Apple Wallet pak fetchne aktuální .pkpass přes
 *   /api/wallet/apple/v1/passes/[passTypeId]/[serialNumber].
 */
import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

interface RouteParams {
  params: {
    deviceLibraryId: string;
    passTypeId: string;
  };
}

export async function GET(
  req: NextRequest,
  { params }: RouteParams,
): Promise<Response> {
  const sinceTag = new URL(req.url).searchParams.get('passesUpdatedSince') ?? '0';
  const sinceMs = Number(sinceTag) || 0;

  const r = await db().query<{ serial_number: string; updated_at: string }>(
    `SELECT DISTINCT s.serial_number,
            COALESCE(MAX(u.created_at)::text, s.registered_at::text) AS updated_at
       FROM tickets.wallet_push_subscriptions s
  LEFT JOIN tickets.pass_updates_log u ON u.ticket_id = s.ticket_id
      WHERE s.device_library_id = $1
        AND s.pass_type_id = $2
        AND s.unregistered_at IS NULL
   GROUP BY s.serial_number, s.registered_at
     HAVING COALESCE(MAX(EXTRACT(EPOCH FROM u.created_at) * 1000)::bigint,
                     EXTRACT(EPOCH FROM s.registered_at) * 1000)::bigint > $3`,
    [params.deviceLibraryId, params.passTypeId, sinceMs],
  );

  if (r.rows.length === 0) {
    return new NextResponse(null, { status: 204 });
  }

  const lastUpdated = r.rows.reduce(
    (max, row) => Math.max(max, new Date(row.updated_at).getTime()),
    0,
  );

  return NextResponse.json({
    lastUpdated: String(lastUpdated),
    serialNumbers: r.rows.map((row) => row.serial_number),
  });
}
