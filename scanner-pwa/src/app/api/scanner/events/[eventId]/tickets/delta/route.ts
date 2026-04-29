import { NextRequest, NextResponse } from 'next/server';

// ---------------------------------------------------------------------------
// GET /api/scanner/events/{eventId}/tickets/delta
// Returns tickets updated since `since` timestamp for offline sync.
// Query params: since (Unix timestamp in seconds, default 0)
// Headers: Authorization: Bearer token
// ---------------------------------------------------------------------------

interface DeltaResponse {
  tickets: Array<{
    id: string;
    eventId: string;
    holderName: string;
    ticketType: string;
    seatInfo: string | null;
    status: 'valid' | 'refunded' | 'revoked' | 'transferred';
    totpSecret: string;
    updatedAt: string;
  }>;
  deletedIds: string[];
  serverTime: number;
}

function parseAuthHeader(authHeader?: string): string | null {
  if (!authHeader?.startsWith('Bearer ')) return null;
  return authHeader.slice(7);
}

export async function GET(
  request: NextRequest,
  context: { params: { eventId: string } },
): Promise<NextResponse> {
  try {
    // --- Auth check ---
    const authHeader = request.headers.get('Authorization');
    const token = parseAuthHeader(authHeader);
    if (!token) {
      return NextResponse.json(
        { error: 'Missing or invalid Authorization header' },
        { status: 401 },
      );
    }

    const { eventId } = await context.params;
    const sinceStr = request.nextUrl.searchParams.get('since') || '0';
    const since = parseInt(sinceStr, 10);

    if (isNaN(since)) {
      return NextResponse.json(
        { error: 'Invalid since parameter' },
        { status: 400 },
      );
    }

    const { Client } = await import('pg');
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();

    try {
      // Get tickets updated since the provided timestamp
      const ticketsResult = await client.query(
        `
        SELECT
          t.id,
          t.event_id,
          t.holder_name,
          t.ticket_type,
          t.seat_info,
          t.status,
          t.totp_secret,
          t.updated_at
        FROM tickets.tickets t
        WHERE t.event_id = $1
          AND EXTRACT(EPOCH FROM t.updated_at) > $2
          AND t.status != 'deleted'
        ORDER BY t.updated_at DESC
        `,
        [eventId, since],
      );

      // Get tickets that were deleted since the provided timestamp
      const deletedResult = await client.query(
        `
        SELECT t.id
        FROM tickets.tickets t
        WHERE t.event_id = $1
          AND t.status = 'deleted'
          AND EXTRACT(EPOCH FROM t.updated_at) > $2
        `,
        [eventId, since],
      );

      const tickets = ticketsResult.rows.map((row) => ({
        id: row.id,
        eventId: row.event_id,
        holderName: row.holder_name,
        ticketType: row.ticket_type,
        seatInfo: row.seat_info,
        status: row.status,
        totpSecret: row.totp_secret,
        updatedAt: new Date(row.updated_at).toISOString(),
      }));

      const deletedIds = deletedResult.rows.map((row) => row.id);

      const response: DeltaResponse = {
        tickets,
        deletedIds,
        serverTime: Math.floor(Date.now() / 1000),
      };

      return NextResponse.json(response, { status: 200 });
    } finally {
      await client.end();
    }
  } catch (err) {
    console.error('[scanner/events/{eventId}/tickets/delta]', err);
    return NextResponse.json(
      { error: 'Failed to fetch ticket delta' },
      { status: 500 },
    );
  }
}
