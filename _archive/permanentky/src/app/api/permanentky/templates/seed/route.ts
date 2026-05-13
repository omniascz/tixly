import { NextRequest, NextResponse } from 'next/server';
import { getServiceDeps } from '../../../../../lib/service-container.js';
import { errorResponse } from '../../../../../lib/route-helpers.js';
import { seedDefaultTemplates } from '../../../../../services/package-template.service.js';

export async function POST(req: NextRequest) {
  try {
    if (req.headers.get('x-is-admin') !== 'true') {
      return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
    }
    const promoterId = req.nextUrl.searchParams.get('promoterId');
    if (!promoterId) {
      return NextResponse.json({ error: 'MISSING_PROMOTER_ID' }, { status: 400 });
    }
    const result = await seedDefaultTemplates(promoterId, getServiceDeps());
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
