import { NextResponse } from 'next/server';
import { z } from 'zod';
import { sendBulkConfirmationSms } from '../../../../../services/sms-confirmation.service.js';
import { getServiceDeps } from '../../../../../lib/service-container.js';
import { SmsError } from '../../../../../lib/sms-errors.js';

const schema = z.object({
  phoneNumbers: z.array(z.string()).min(1).max(1000),
  code: z.string().regex(/^\d{6}$/, 'Kód musí obsahovat právě 6 číslic'),
  eventName: z.string().min(1).max(255),
  eventId: z.string().uuid().optional(),
  promoterId: z.string().uuid().optional(),
});

export async function POST(req: Request): Promise<Response> {
  const userId = req.headers.get('x-user-id');
  const role = req.headers.get('x-user-role');
  if (!userId || role !== 'admin') {
    return NextResponse.json(
      { error: 'FORBIDDEN', message: 'Hromadné SMS potvrzení může odesílat pouze admin.' },
      { status: 403 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: 'INVALID_JSON', message: 'Neplatný JSON.' },
      { status: 400 },
    );
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'VALIDATION_ERROR', issues: parsed.error.issues },
      { status: 400 },
    );
  }

  try {
    const result = await sendBulkConfirmationSms(parsed.data, getServiceDeps());
    return NextResponse.json({
      sent: result.sent,
      failed: result.failed,
      results: result.results,
    });
  } catch (err) {
    if (err instanceof SmsError) {
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status: err.statusCode },
      );
    }
    return NextResponse.json(
      { error: 'INTERNAL_ERROR', message: 'Interní chyba serveru.' },
      { status: 500 },
    );
  }
}
