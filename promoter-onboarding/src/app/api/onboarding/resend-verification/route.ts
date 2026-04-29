import { NextRequest, NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { ResendVerificationSchema } from '../../../../lib/zod-schemas';
import { resendVerificationEmail } from '../../../../services/onboarding.service';
import type { ServiceDeps } from '../../../../lib/service-container';
import { getServiceDeps } from '../../../../lib/service-container.js';

export async function POST(
  request: NextRequest,
  context?: { deps?: ServiceDeps },
): Promise<NextResponse> {
  const deps: ServiceDeps = context?.deps ?? getServiceDeps();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    // Anti-enumeration: always return 204 even on bad input
    return new NextResponse(null, { status: 204 });
  }

  let input;
  try {
    input = ResendVerificationSchema.parse(body);
  } catch (err) {
    if (err instanceof ZodError) {
      // Anti-enumeration: always 204
      return new NextResponse(null, { status: 204 });
    }
    throw err;
  }

  try {
    // Look up userId by email — always silently succeed (anti-enumeration)
    const userRows = await deps.db
      .query<{ id: string }>(
        'SELECT id FROM identity.users WHERE email = $1',
        [input.email.toLowerCase()],
      )
      .catch(() => []);

    if (userRows.length > 0) {
      await resendVerificationEmail(userRows[0].id, deps).catch(() => {});
    }
  } catch {
    // Swallow all errors — anti-enumeration
  }

  return new NextResponse(null, { status: 204 });
}

