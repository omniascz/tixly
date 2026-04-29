import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { assignLead } from '../../../../../../../services/lead.service.js';
import { getServiceDeps } from '../../../../../../../lib/service-container.js';
import { LeadCaptureError } from '../../../../../../../lib/lead-errors.js';

const schema = z.object({ userId: z.string().uuid() });

export async function POST(
  req: NextRequest,
  { params }: { params: { promoterId: string; leadId: string } },
) {
  try {
    const body = await req.json();
    const { userId } = schema.parse(body);
    const deps = getServiceDeps();
    const lead = await assignLead(
      params.leadId,
      params.promoterId,
      userId,
      deps,
    );
    return NextResponse.json({ lead });
  } catch (err) {
    if (err instanceof LeadCaptureError) {
      return NextResponse.json(
        { success: false, code: err.code, message: err.message },
        { status: err.statusCode },
      );
    }
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, message: 'Neplatný vstup.' },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { success: false, message: 'Interní chyba serveru.' },
      { status: 500 },
    );
  }
}
