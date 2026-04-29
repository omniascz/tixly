import { NextRequest, NextResponse } from 'next/server';
import {
  getBadgeForActivation,
  type BadgePrintDB,
} from '../../../../../services/badge-print.service';
import {
  setOverride,
  type BadgeOverrideDB,
  type SetOverrideInput,
} from '../../../../../services/badge-override.service';
import { isBadgeError } from '../../../../../lib/badge-errors';

function getProductionDb(): BadgePrintDB & BadgeOverrideDB {
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
    return new NextResponse(badge.svgContent, {
      status: 200,
      headers: { 'Content-Type': 'image/svg+xml' },
    });
  } catch (err) {
    if (isBadgeError(err)) return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    throw err;
  }
}

export async function POST(
  request: NextRequest,
  { params, db }: { params: { activationId: string }; db?: BadgeOverrideDB },
): Promise<NextResponse> {
  const resolvedDb = db ?? getProductionDb();
  try {
    const body = await request.json() as SetOverrideInput;
    const override = await setOverride(params.activationId, body, resolvedDb);
    return NextResponse.json(override, { status: 200 });
  } catch (err) {
    if (isBadgeError(err)) return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    throw err;
  }
}
