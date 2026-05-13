import { NextResponse } from 'next/server';
import { z } from 'zod';
import { sendBulkSms } from '../../../../services/sms.service.js';
import { getServiceDeps } from '../../../../lib/service-container.js';
import { SmsError } from '../../../../lib/sms-errors.js';

const schema = z.object({
  promoterId: z.string().uuid(),
  phones: z.array(z.string()).min(1).max(1000),
  text: z.string().min(1).max(2000),
  category: z.literal('marketing'),
  segmentName: z.string().optional(),
});

export async function POST(req: Request): Promise<Response> {
  const userId = req.headers.get('x-user-id');
  const role = req.headers.get('x-user-role');
  if (!userId || role !== 'admin') {
    return NextResponse.json(
      { error: 'FORBIDDEN', message: 'Hromadné SMS může odesílat pouze admin.' },
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
    const result = await sendBulkSms(parsed.data, getServiceDeps());
    return NextResponse.json(result);
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
