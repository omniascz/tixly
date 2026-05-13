import { NextResponse } from 'next/server';
import { z } from 'zod';
import { sendConfirmationSms } from '../../../../../services/sms-confirmation.service.js';
import { getServiceDeps } from '../../../../../lib/service-container.js';
import { SmsError } from '../../../../../lib/sms-errors.js';

const schema = z.object({
  phoneNumber: z.string().min(5).max(32),
  code: z.string().regex(/^\d{6}$/, 'Kód musí obsahovat právě 6 číslic'),
  eventName: z.string().min(1).max(255),
  eventId: z.string().uuid().optional(),
  promoterId: z.string().uuid().optional(),
});

export async function POST(req: Request): Promise<Response> {
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
    const result = await sendConfirmationSms(parsed.data, getServiceDeps());
    return NextResponse.json({
      success: result.success,
      messageId: result.messageId,
      sentAt: result.sentAt.toISOString(),
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
