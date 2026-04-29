import { NextRequest, NextResponse } from 'next/server';
import {
  getBadgeForActivation,
  type BadgePrintDB,
} from '../../../../../../services/badge-print.service';
import { isBadgeError } from '../../../../../../lib/badge-errors';

function getProductionDb(): BadgePrintDB {
  throw new Error('Production DB not configured. Use dependency injection.');
}

export async function GET(
  request: NextRequest,
  { params, db }: { params: { activationId: string }; db?: BadgePrintDB },
): Promise<NextResponse> {
  const resolvedDb = db ?? getProductionDb();
  const templateId = request.nextUrl.searchParams.get('templateId') ?? '';
  try {
    const badge = await getBadgeForActivation(params.activationId, templateId, resolvedDb);
    return new NextResponse(badge.pdfBytes, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="badge-${params.activationId}.pdf"`,
        'Content-Length': String(badge.pdfBytes.length),
      },
    });
  } catch (err) {
    if (isBadgeError(err)) return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    throw err;
  }
}
