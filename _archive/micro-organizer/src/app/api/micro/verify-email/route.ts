import { NextRequest, NextResponse } from 'next/server';
import { z, ZodError } from 'zod';
import { verifyMicroOrganizerEmail } from '../../../../services/micro-organizer.service.js';
import { isMicroOrganizerError } from '../../../../lib/micro-organizer-errors.js';
import { getServiceDeps } from '../../../../lib/service-container.js';
import type { ServiceDeps } from '../../../../lib/service-container.js';

const VerifyEmailSchema = z.object({
  token: z.string({ required_error: 'Token je povinný.' }).min(1, 'Token nesmí být prázdný.'),
});

export async function POST(
  request: NextRequest,
  context?: { deps?: ServiceDeps },
): Promise<NextResponse> {
  const deps: ServiceDeps = context?.deps ?? getServiceDeps();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'INVALID_JSON', message: 'Neplatné tělo požadavku.' },
      { status: 400 },
    );
  }

  let input;
  try {
    input = VerifyEmailSchema.parse(body);
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json(
        { error: 'VALIDATION_ERROR', message: 'Neplatný vstup.', details: err.errors },
        { status: 400 },
      );
    }
    throw err;
  }

  try {
    const result = await verifyMicroOrganizerEmail(input.token, deps);
    return NextResponse.json(
      {
        organizerId: result.organizerId,
        email: result.email,
        message: 'E-mail byl úspěšně ověřen. Váš účet je aktivní.',
      },
      { status: 200 },
    );
  } catch (err) {
    if (isMicroOrganizerError(err)) {
      return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    }
    throw err;
  }
}
