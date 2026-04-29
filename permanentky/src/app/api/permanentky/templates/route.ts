import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getServiceDeps } from '../../../../lib/service-container.js';
import { errorResponse } from '../../../../lib/route-helpers.js';
import {
  createTemplate,
  listTemplates,
} from '../../../../services/package-template.service.js';

const createSchema = z.object({
  promoterId: z.string().uuid(),
  name: z.string().min(1),
  type: z.enum(['mesicni', '10lekci', 'custom']),
  totalCredits: z.number().int().positive(),
  validityDays: z.number().int().positive(),
  priceHalire: z.number().int().nonnegative(),
  description: z.string().optional(),
});

export async function GET(req: NextRequest) {
  try {
    const promoterId = req.nextUrl.searchParams.get('promoterId');
    if (!promoterId) {
      return NextResponse.json({ error: 'MISSING_PROMOTER_ID' }, { status: 400 });
    }
    const templates = await listTemplates(promoterId, getServiceDeps());
    return NextResponse.json({ templates });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = createSchema.parse(body);
    const { promoterId, ...input } = parsed;
    const template = await createTemplate(promoterId, input, getServiceDeps());
    return NextResponse.json({ template }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
