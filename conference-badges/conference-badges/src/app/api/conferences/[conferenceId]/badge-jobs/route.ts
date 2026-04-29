import { NextRequest, NextResponse } from 'next/server';
import {
  createPrintJob,
  listJobs,
  type BadgePrintDB,
} from '../../../../../services/badge-print.service';
import { isBadgeError } from '../../../../../lib/badge-errors';

function getProductionDb(): BadgePrintDB {
  throw new Error('Production DB not configured. Use dependency injection.');
}

export async function GET(
  _request: NextRequest,
  { params, db }: { params: { conferenceId: string }; db?: BadgePrintDB },
): Promise<NextResponse> {
  const resolvedDb = db ?? getProductionDb();
  try {
    const jobs = await listJobs(params.conferenceId, resolvedDb);
    return NextResponse.json(jobs);
  } catch (err) {
    if (isBadgeError(err)) return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    throw err;
  }
}

export async function POST(
  request: NextRequest,
  { params, db }: { params: { conferenceId: string }; db?: BadgePrintDB },
): Promise<NextResponse> {
  const resolvedDb = db ?? getProductionDb();
  try {
    const body = await request.json() as { templateId: string; requestedBy: string };
    const job = await createPrintJob(params.conferenceId, body.templateId, body.requestedBy, resolvedDb);
    return NextResponse.json(job, { status: 201 });
  } catch (err) {
    if (isBadgeError(err)) return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    throw err;
  }
}
