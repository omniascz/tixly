import { NextResponse } from 'next/server';
import { SnippetError } from './snippet-errors.js';

export function errorResponse(err: unknown): NextResponse {
  if (err instanceof SnippetError) {
    return NextResponse.json(
      { error: { code: err.code, message: err.message } },
      { status: err.status },
    );
  }
  console.error('[web-content-cms] Unexpected error:', err);
  return NextResponse.json(
    { error: { code: 'INTERNAL', message: 'Interní chyba serveru.' } },
    { status: 500 },
  );
}

export function requireUserId(request: Request): string {
  const userId = request.headers.get('x-user-id');
  if (!userId) {
    throw new SnippetError('SNIPPET_NOT_FOUND', 'Chybí x-user-id hlavička.');
  }
  return userId;
}
