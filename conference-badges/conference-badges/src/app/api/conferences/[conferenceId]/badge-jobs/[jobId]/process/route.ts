import { NextRequest, NextResponse } from 'next/server';
import {
  processPrintJob,
  type BadgePrintDB,
} from '../../../../../../../services/badge-print.service';
import { isBadgeError } from '../../../../../../../lib/badge-errors';

function getProductionDb(): BadgePrintDB {
  throw new Error('Production DB not configured. Use dependency injection.');
}

export async function POST(
  _request: NextRequest,
  { params, db }: { params: { conferenceId: string; jobId: string }; db?: BadgePrintDB },
): Promise<NextResponse> {
  const resolvedDb = db ?? getProductionDb();
  try {
    const job = await processPrintJob(params.jobId, resolvedDb);
    return NextResponse.json(job);
  } catch (err) {
    if (isBadgeError(err)) return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    throw err;
  }
}
