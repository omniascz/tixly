import { NextResponse } from 'next/server';
import { LandingPageError } from './landing-errors.js';

export function errorResponse(err: unknown): NextResponse {
  if (err instanceof LandingPageError) {
    return NextResponse.json(
      { error: { code: err.code, message: err.message } },
      { status: err.status },
    );
  }
  console.error('[landing-pages] Unexpected error:', err);
  return NextResponse.json(
    { error: { code: 'INTERNAL', message: 'Interní chyba serveru.' } },
    { status: 500 },
  );
}

/**
 * Extract user id from request headers. In production this would be verified
 * via JWT; here we accept `x-user-id` header as a stub.
 */
export function requireUserId(request: Request): string {
  const userId = request.headers.get('x-user-id');
  if (!userId) {
    throw new LandingPageError('PAGE_NOT_OWNED', 'Chybí x-user-id hlavička.');
  }
  return userId;
}

/**
 * Stub membership check — verifies the user belongs to the promoter.
 * Real implementation would query promoter_members table.
 */
export async function assertPromoterMembership(
  _userId: string,
  _promoterId: string,
): Promise<void> {
  // TODO: wire to promoter_members table when admin auth module is integrated.
  return;
}
