import { NextRequest, NextResponse } from 'next/server';
import {
  createTemplate,
  listTemplates,
  type BadgeTemplateDB,
  type CreateTemplateInput,
} from '../../../../../services/badge-template.service';
import { isBadgeError } from '../../../../../lib/badge-errors';

function getProductionDb(): BadgeTemplateDB {
  throw new Error('Production DB not configured. Use dependency injection.');
}

export async function GET(
  _request: NextRequest,
  { params, db }: { params: { conferenceId: string }; db?: BadgeTemplateDB },
): Promise<NextResponse> {
  const resolvedDb = db ?? getProductionDb();
  try {
    const templates = await listTemplates(params.conferenceId, resolvedDb);
    return NextResponse.json(templates);
  } catch (err) {
    if (isBadgeError(err)) return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    throw err;
  }
}

export async function POST(
  request: NextRequest,
  { params, db }: { params: { conferenceId: string }; db?: BadgeTemplateDB },
): Promise<NextResponse> {
  const resolvedDb = db ?? getProductionDb();
  try {
    const body = await request.json() as CreateTemplateInput;
    const template = await createTemplate(params.conferenceId, body, resolvedDb);
    return NextResponse.json(template, { status: 201 });
  } catch (err) {
    if (isBadgeError(err)) return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    throw err;
  }
}
