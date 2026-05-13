import { NextRequest, NextResponse } from 'next/server';
import { ResaleListingService } from '../../../services/resale-listing.service';
import { WatchlistService } from '../../../services/watchlist.service';
import type {
  ResaleListingPublic,
  PaginatedResponse,
  DbRow,
} from '../../../types/resale';
import { toHttpError } from '../../../lib/resale-errors';
import { getServiceContainer } from '../../../lib/service-container';

// ---------------------------------------------------------------------------
// DB row shape returned by the listing query
// ---------------------------------------------------------------------------

interface ListingQueryRow extends DbRow {
  id: string;
  ticket_id: string;
  ask_price: string;
  original_price: string;
  status: string;
  escrow_status: string;
  listed_at: string;
  expires_at: string | null;
  reserved_until: string | null;
  sold_at: string | null;
  zone: string | null;
  event_id: string;
  total_count: string;
}

function toPublic(row: ListingQueryRow): ResaleListingPublic {
  return {
    id: row.id,
    ticketId: row.ticket_id,
    askPrice: parseFloat(row.ask_price),
    originalPrice: parseFloat(row.original_price),
    status: row.status as ResaleListingPublic['status'],
    escrowStatus: row.escrow_status as ResaleListingPublic['escrowStatus'],
    listedAt: new Date(row.listed_at),
    expiresAt: row.expires_at ? new Date(row.expires_at) : null,
    reservedUntil: row.reserved_until ? new Date(row.reserved_until) : null,
    soldAt: row.sold_at ? new Date(row.sold_at) : null,
    zone: row.zone,
    eventId: row.event_id,
  };
}

// ---------------------------------------------------------------------------
// GET /api/resale — list active listings with filters
// Response is real-time data; no caching.
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = request.nextUrl;

  const eventId = searchParams.get('event_id');
  const zone = searchParams.get('zone');
  const maxPrice = searchParams.get('max_price');
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10));
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') ?? '20', 10)));
  const offset = (page - 1) * limit;

  const { db } = getServiceContainer();

  try {
    // FIFO ordering: best price first, then oldest listing for ties
    const params: unknown[] = [];
    const conditions: string[] = ["rl.status = 'active'"];

    if (eventId) {
      params.push(eventId);
      conditions.push(`e.id = $${params.length}`);
    }

    if (zone) {
      params.push(zone);
      conditions.push(`tt.zone = $${params.length}`);
    }

    if (maxPrice) {
      params.push(parseFloat(maxPrice));
      conditions.push(`rl.ask_price <= $${params.length}`);
    }

    const where = conditions.join(' AND ');

    params.push(limit, offset);
    const limitPlaceholder = `$${params.length - 1}`;
    const offsetPlaceholder = `$${params.length}`;

    const rows = await db.query<ListingQueryRow>(
      `SELECT rl.id,
              rl.ticket_id,
              rl.ask_price,
              rl.original_price,
              rl.status,
              rl.escrow_status,
              rl.listed_at,
              rl.expires_at,
              rl.reserved_until,
              rl.sold_at,
              tt.zone,
              e.id AS event_id,
              COUNT(*) OVER () AS total_count
       FROM resale.resale_listings rl
       JOIN tickets.tickets t ON t.id = rl.ticket_id
       JOIN catalog.ticket_types tt ON tt.id = t.ticket_type_id
       JOIN catalog.events e ON e.id = tt.event_id
       WHERE ${where}
       ORDER BY rl.ask_price ASC, rl.listed_at ASC
       LIMIT ${limitPlaceholder} OFFSET ${offsetPlaceholder}`,
      params,
    );

    const total = rows.length > 0 ? parseInt(rows[0].total_count, 10) : 0;

    const response: PaginatedResponse<ResaleListingPublic> = {
      data: rows.map(toPublic),
      total,
      page,
      limit,
      hasMore: offset + rows.length < total,
    };

    return NextResponse.json(response, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (err) {
    const { status, body } = toHttpError(err);
    return NextResponse.json(body, { status });
  }
}

// ---------------------------------------------------------------------------
// POST /api/resale — create a new listing (authenticated seller)
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest): Promise<NextResponse> {
  const sellerId = request.headers.get('x-user-id');

  if (!sellerId) {
    return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });
  }

  try {
    const body = await request.json() as { ticketId?: unknown; askPrice?: unknown };

    if (typeof body.ticketId !== 'string' || typeof body.askPrice !== 'number') {
      return NextResponse.json(
        { error: 'ticketId (string) and askPrice (number) are required', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }

    const { resaleListingService, watchlistService } = getServiceContainer();

    const listing = await resaleListingService.createListing(sellerId, {
      ticketId: body.ticketId,
      askPrice: body.askPrice,
    });

    // Notify watchlist users asynchronously — don't block the response
    void watchlistService.notifyWatchlistUsers(listing);

    // Return public shape (no gopayPaymentId)
    const publicListing: ResaleListingPublic = {
      id: listing.id,
      ticketId: listing.ticketId,
      askPrice: listing.askPrice,
      originalPrice: listing.originalPrice,
      status: listing.status,
      escrowStatus: listing.escrowStatus,
      listedAt: listing.listedAt,
      expiresAt: listing.expiresAt,
      reservedUntil: listing.reservedUntil,
      soldAt: listing.soldAt,
      zone: null, // resolved in GET; not needed on creation response
      eventId: '',
    };

    return NextResponse.json(publicListing, { status: 201 });
  } catch (err) {
    const { status, body } = toHttpError(err);
    return NextResponse.json(body, { status });
  }
}
