import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { subscribe } from '../../../../services/newsletter.service.js';
import { getServiceDeps } from '../../../../lib/service-container.js';
import { NewsletterError } from '../../../../lib/newsletter-errors.js';

const schema = z.object({
  promoterId: z.string().uuid(),
  email: z.string().email(),
  firstName: z.string().optional(),
  source: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = schema.parse(body);
    const deps = getServiceDeps();
    await subscribe(parsed, deps);
    // Don't expose subscriber id publicly
    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof NewsletterError) {
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
