import { NextRequest, NextResponse } from 'next/server';
import {
  verifyStaffAccess,
  type StaffDB,
} from '../../../../services/staff.service';
import { isExhibitorError } from '../../../../lib/exhibitor-errors';

function getProductionDb(): StaffDB {
  throw new Error('Production DB not configured. Use dependency injection.');
}

export async function POST(
  request: NextRequest,
  { db }: { db?: StaffDB } = {},
): Promise<NextResponse> {
  const resolvedDb = db ?? getProductionDb();
  try {
    const body = await request.json() as { accessToken: string };
    const result = await verifyStaffAccess(body.accessToken, resolvedDb);
    if (!result) {
      return NextResponse.json({ error: 'STAFF_NOT_FOUND', message: 'Invalid access token.' }, { status: 404 });
    }
    return NextResponse.json(result);
  } catch (err) {
    if (isExhibitorError(err)) return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    throw err;
  }
}
