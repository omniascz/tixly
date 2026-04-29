import { NextResponse } from 'next/server';
import { ConsentError } from './consent-errors.js';

export function errorResponse(err: unknown): NextResponse {
  if (err instanceof ConsentError) {
    return NextResponse.json(
      { error: { code: err.code, message: err.message } },
      { status: err.status },
    );
  }
  console.error('[cookie-consent] Unexpected error:', err);
  return NextResponse.json(
    { error: { code: 'INTERNAL', message: 'Interní chyba serveru.' } },
    { status: 500 },
  );
}
