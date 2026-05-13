import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  addOptOut,
  removeOptOut,
} from '../../../../../services/sms-confirmation.service.js';
import { getServiceDeps } from '../../../../../lib/service-container.js';
import { SmsError } from '../../../../../lib/sms-errors.js';

const postSchema = z.object({
  phoneNumber: z.string().min(5).max(32),
  userId: z.string().uuid().optional(),
  reason: z.string().max(255).optional(),
});

const deleteSchema = z.object({
  phoneNumber: z.string().min(5).max(32),
});

/**
 * POST: User opts out from SMS confirmations
 */
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

  const parsed = postSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'VALIDATION_ERROR', issues: parsed.error.issues },
      { status: 400 },
    );
  }

  try {
    const result = await addOptOut(
      parsed.data.phoneNumber,
      parsed.data.userId,
      parsed.data.reason,
      getServiceDeps(),
    );
    return NextResponse.json({
      success: result.success,
      optedOut: result.optedOut,
      phone: result.phone,
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

/**
 * DELETE: Admin removes opt-out
 */
export async function DELETE(req: Request): Promise<Response> {
  const userId = req.headers.get('x-user-id');
  const role = req.headers.get('x-user-role');
  if (!userId || role !== 'admin') {
    return NextResponse.json(
      { error: 'FORBIDDEN', message: 'Správu opt-out může provádět pouze admin.' },
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

  const parsed = deleteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'VALIDATION_ERROR', issues: parsed.error.issues },
      { status: 400 },
    );
  }

  try {
    const result = await removeOptOut(parsed.data.phoneNumber, getServiceDeps());
    return NextResponse.json({
      success: result.success,
      optedOut: result.optedOut,
      phone: result.phone,
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
