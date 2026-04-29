import { NextRequest, NextResponse } from 'next/server';
import { createVenue, listVenues } from '../../../../services/venue.service';
import { isEntryError } from '../../../../lib/entry-errors';
import type { EntryDB, CreateVenueInput, ListVenuesFilters, VenueType } from '../../../../services/venue.service';

export interface VenuesDeps {
  db: EntryDB;
}

// ---------------------------------------------------------------------------
// GET /api/entry/venues?promoterId=&venueType=&city=
// ---------------------------------------------------------------------------
export async function GET(
  request: NextRequest,
  context?: { deps?: VenuesDeps },
): Promise<NextResponse> {
  const deps = context?.deps ?? getProductionDeps();
  const sp = request.nextUrl.searchParams;

  const promoterId = sp.get('promoterId');
  if (!promoterId) {
    return NextResponse.json({ error: 'MISSING_PROMOTER_ID' }, { status: 400 });
  }

  const filters: ListVenuesFilters = {
    venueType: (sp.get('venueType') as VenueType) ?? undefined,
    city: sp.get('city') ?? undefined,
  };

  try {
    const venues = await listVenues(promoterId, filters, deps.db);
    return NextResponse.json({ venues }, { status: 200 });
  } catch (err) {
    if (isEntryError(err)) {
      return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// POST /api/entry/venues
// ---------------------------------------------------------------------------
export async function POST(
  request: NextRequest,
  context?: { deps?: VenuesDeps },
): Promise<NextResponse> {
  const deps = context?.deps ?? getProductionDeps();

  const body = await request.json() as { promoterId?: string } & Partial<CreateVenueInput>;
  const { promoterId, ...input } = body;

  if (!promoterId) {
    return NextResponse.json({ error: 'MISSING_PROMOTER_ID' }, { status: 400 });
  }

  try {
    const venue = await createVenue(promoterId, input as CreateVenueInput, deps.db);
    return NextResponse.json({ venue }, { status: 201 });
  } catch (err) {
    if (isEntryError(err)) {
      return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    }
    throw err;
  }
}

function getProductionDeps(): VenuesDeps {
  throw new Error('Production dependencies not configured. Use dependency injection.');
}
