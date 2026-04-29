import { NextRequest, NextResponse } from 'next/server';
import {
  addStaff,
  listStaff,
  type StaffDB,
  type AddStaffInput,
} from '../../../../../../../services/staff.service';
import { isExhibitorError } from '../../../../../../../lib/exhibitor-errors';

function getProductionDb(): StaffDB {
  throw new Error('Production DB not configured. Use dependency injection.');
}

export async function GET(
  _request: NextRequest,
  { params, db }: { params: { conferenceId: string; exhibitorId: string }; db?: StaffDB },
): Promise<NextResponse> {
  const resolvedDb = db ?? getProductionDb();
  try {
    const staff = await listStaff(params.exhibitorId, resolvedDb);
    return NextResponse.json(staff);
  } catch (err) {
    if (isExhibitorError(err)) return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    throw err;
  }
}

export async function POST(
  request: NextRequest,
  { params, db }: { params: { conferenceId: string; exhibitorId: string }; db?: StaffDB },
): Promise<NextResponse> {
  const resolvedDb = db ?? getProductionDb();
  try {
    const body = await request.json() as AddStaffInput;
    const staff = await addStaff(params.exhibitorId, body, resolvedDb);
    return NextResponse.json(staff, { status: 201 });
  } catch (err) {
    if (isExhibitorError(err)) return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    throw err;
  }
}
