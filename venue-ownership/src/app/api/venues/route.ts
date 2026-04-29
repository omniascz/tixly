import { NextRequest, NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { listPublicVenues } from '../../../services/venue.service.js';
import { ListPublicVenuesQuerySchema } from '../../../lib/zod-schemas.js';
import { VenueError } from '../../../lib/venue-errors.js';
import { getServiceDeps } from '../../../lib/service-container.js';

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = request.nextUrl;
    const query = ListPublicVenuesQuerySchema.parse({
      city: searchParams.get('city') ?? undefined,
      country: searchParams.get('country') ?? undefined,
      minCapacity: searchParams.get('minCapacity') ?? undefined,
      search: searchParams.get('search') ?? undefined,
      limit: searchParams.get('limit') ?? undefined,
      offset: searchParams.get('offset') ?? undefined,
    });

    const deps = getServiceDeps();
    const result = await listPublicVenues(
      { city: query.city, country: query.country, minCapacity: query.minCapacity, search: query.search },
      { limit: query.limit, offset: query.offset },
      deps,
    );

    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: { code: 'VALIDATION_ERROR', issues: err.issues } }, { status: 400 });
    }
    if (err instanceof VenueError) {
      return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    }
    return NextResponse.json({ error: { code: 'INTERNAL_ERROR' } }, { status: 500 });
  }
}
