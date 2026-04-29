import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getServiceDeps } from '../../../../lib/service-container.js';
import { errorResponse } from '../../../../lib/route-helpers.js';
import { purchasePackage } from '../../../../services/permanentky.service.js';

const schema = z.object({
  templateId: z.string().uuid(),
  clientId: z.string().uuid(),
  paymentRef: z.string().optional(),
  validFrom: z.string().datetime().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = schema.parse(body);
    const pkg = await purchasePackage(
      {
        templateId: parsed.templateId,
        clientId: parsed.clientId,
        paymentRef: parsed.paymentRef,
        validFrom: parsed.validFrom ? new Date(parsed.validFrom) : undefined,
      },
      getServiceDeps(),
    );
    return NextResponse.json({ package: pkg }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
