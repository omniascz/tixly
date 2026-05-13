import { NextResponse } from 'next/server';
import { z } from 'zod';
import { sendSingleSms } from '../../../../services/sms.service.js';
import { getServiceDeps } from '../../../../lib/service-container.js';
import { SmsError } from '../../../../lib/sms-errors.js';

const schema = z.object({
  promoterId: z.string().uuid().optional(),
  phone: z.string().min(5).max(32),
  text: z.string().min(1).max(2000),
  category: z.enum(['transactional', 'marketing']),
});

export async function POST(req: Request): Promise<Response> {
  const userId = req.headers.get('x-user-id');
  if (!userId) {
    return NextResponse.json(
      { error: 'UNAUTHORIZED', message: 'Chybí x-user-id hlavička.' },
      { status: 401 },
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

  const promoterHeader = req.headers.get('x-promoter-id') ?? undefined;
  const input = {
    ...parsed.data,
    promoterId: parsed.data.promoterId ?? promoterHeader,
  };

  try {
    const result = await sendSingleSms(input, getServiceDeps());
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
