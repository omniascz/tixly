import { NextResponse } from 'next/server';
import { z } from 'zod';
import { optOutRecipient } from '../../../../services/sms.service.js';
import { getServiceDeps } from '../../../../lib/service-container.js';
import { SmsError } from '../../../../lib/sms-errors.js';

const schema = z.object({
  phone: z.string().min(5).max(32),
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
    await optOutRecipient(parsed.data.phone, getServiceDeps());
    return NextResponse.json({ success: true });
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
