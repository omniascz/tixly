import { NextResponse } from 'next/server';
import { RuntimeConfigError } from './config-errors.js';

export function errorResponse(err: unknown): NextResponse {
  if (err instanceof RuntimeConfigError) {
    return NextResponse.json(
      { error: { code: err.code, message: err.message } },
      { status: err.status },
    );
  }
  console.error('[tenant-runtime-config] Unexpected error:', err);
  return NextResponse.json(
    { error: { code: 'INTERNAL', message: 'Interní chyba serveru.' } },
    { status: 500 },
  );
}

export function requireUserId(request: Request): string {
  const userId = request.headers.get('x-user-id');
  if (!userId) {
    throw new RuntimeConfigError('VALIDATION_FAILED', 'Chybí x-user-id hlavička.');
  }
  return userId;
}
