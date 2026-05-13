import { NextRequest, NextResponse } from 'next/server';
import {
  getTemplate,
  updateTemplate,
  type BadgeTemplateDB,
  type UpdateTemplateInput,
} from '../../../../../../services/badge-template.service';
import { isBadgeError } from '../../../../../../lib/badge-errors';

function getProductionDb(): BadgeTemplateDB {
  throw new Error('Production DB not configured. Use dependency injection.');
}

export async function GET(
  _request: NextRequest,
  { params, db }: { params: { conferenceId: string; templateId: string }; db?: BadgeTemplateDB },
): Promise<NextResponse> {
  const resolvedDb = db ?? getProductionDb();
  try {
    const template = await getTemplate(params.templateId, resolvedDb);
    return NextResponse.json(template);
  } catch (err) {
    if (isBadgeError(err)) return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    throw err;
  }
}

export async function PATCH(
  request: NextRequest,
  { params, db }: { params: { conferenceId: string; templateId: string }; db?: BadgeTemplateDB },
): Promise<NextResponse> {
  const resolvedDb = db ?? getProductionDb();
  try {
    const body = await request.json() as UpdateTemplateInput;
    const template = await updateTemplate(params.templateId, body, resolvedDb);
    return NextResponse.json(template);
  } catch (err) {
    if (isBadgeError(err)) return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    throw err;
  }
}
