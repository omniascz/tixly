// =============================================================================
// Shared route helpers — JSON error mapping
// =============================================================================

import { NextResponse } from 'next/server';
import { PermanentkyError } from './permanentky-errors.js';

export function errorResponse(err: unknown): NextResponse {
  if (err instanceof PermanentkyError) {
    return NextResponse.json(err.toJSON(), { status: err.status });
  }
  const message = err instanceof Error ? err.message : 'Unknown error';
  return NextResponse.json(
    { error: 'INTERNAL_ERROR', message },
    { status: 500 },
  );
}
