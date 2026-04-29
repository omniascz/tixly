import { NextRequest, NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { adminListVenues, adminCreatePublicVenue } from '../../../../../services/venue.service.js';
import { AdminListVenuesQuerySchema, CreateVenueSchema } from '../../../../../lib/zod-schemas.js';
import { VenueError } from '../../../../../lib/venue-errors.js';
import { getServiceDeps } from '../../../../../lib/service-container.js';

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const adminUserId = request.headers.get('x-admin-user-id');
    if (!adminUserId) {
      return NextResponse.json(
        { error: { code: 'UNAUTHORIZED', message: 'Missing x-admin-user-id header' } },
        { status: 404 },
      );
    }

    const { searchParams } = request.nextUrl;
    const query = AdminListVenuesQuerySchema.parse({
      ownerPromoterId: searchParams.get('ownerPromoterId') ?? undefined,
      isPublic: searchParams.get('isPublic') ?? undefined,
      search: searchParams.get('search') ?? undefined,
      limit: searchParams.get('limit') ?? undefined,
      offset: searchParams.get('offset') ?? undefined,
    });

    const deps = getServiceDeps();
    const result = await adminListVenues(
      {
        ownerPromoterId: query.ownerPromoterId,
        isPublic: query.isPublic,
        search: query.search,
      },
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

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const adminUserId = request.headers.get('x-admin-user-id');
    if (!adminUserId) {
      return NextResponse.json(
        { error: { code: 'UNAUTHORIZED', message: 'Missing x-admin-user-id header' } },
        { status: 404 },
      );
    }

    const body = await request.json();
    const input = CreateVenueSchema.parse(body);

    const deps = getServiceDeps();
    const venue = await adminCreatePublicVenue(input, adminUserId, deps);
    return NextResponse.json(venue, { status: 201 });
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
