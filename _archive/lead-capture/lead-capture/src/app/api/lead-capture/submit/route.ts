import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createLead } from '../../../../services/lead.service.js';
import { getServiceDeps } from '../../../../lib/service-container.js';
import { LeadCaptureError } from '../../../../lib/lead-errors.js';

const schema = z.object({
  promoterId: z.string().uuid(),
  sourcePage: z.string().optional(),
  source: z.string().optional(),
  firstName: z.string().min(1),
  lastName: z.string().optional(),
  email: z.string().email(),
  phone: z.string().optional(),
  message: z.string().optional(),
  interest: z.string().optional(),
  utmSource: z.string().optional(),
  utmMedium: z.string().optional(),
  utmCampaign: z.string().optional(),
  consented: z.boolean(),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = schema.parse(body);
    const deps = getServiceDeps();
    await createLead(parsed, deps);
    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof LeadCaptureError) {
      return NextResponse.json(
        { success: false, code: err.code, message: err.message },
        { status: err.statusCode },
      );
    }
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, code: 'EMAIL_INVALID', message: 'Neplatný vstup.' },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { success: false, message: 'Interní chyba serveru.' },
      { status: 500 },
    );
  }
}
