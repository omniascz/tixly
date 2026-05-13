import { NextRequest, NextResponse } from 'next/server';
import { z, ZodError } from 'zod';
import {
  addToBlocklist,
  removeFromBlocklist,
  listBlocklist,
} from '../../../../services/blocklist.service.js';
import type { DeviceDeps } from '../../../../services/device.service.js';

const AddSchema = z.object({
  fingerprintHash: z.string().length(64),
  reason: z.string().min(1).max(500),
  blockedBy: z.string().uuid(),
  expiresAt: z.string().datetime().nullable().optional(),
});

const RemoveSchema = z.object({
  fingerprintHash: z.string().length(64),
});

export async function GET(
  request: NextRequest,
  { deps }: { deps?: DeviceDeps } = {},
): Promise<NextResponse> {
  const resolvedDeps = deps ?? getProductionDeps();
  const url = new URL(request.url);
  const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '50', 10), 200);
  const offset = parseInt(url.searchParams.get('offset') ?? '0', 10);

  const result = await listBlocklist(limit, offset, resolvedDeps);
  return NextResponse.json(result);
}

export async function POST(
  request: NextRequest,
  { deps }: { deps?: DeviceDeps } = {},
): Promise<NextResponse> {
  const resolvedDeps = deps ?? getProductionDeps();

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 });
  }

  let input: z.infer<typeof AddSchema>;
  try { input = AddSchema.parse(body); } catch (err) {
    if (err instanceof ZodError) return NextResponse.json({ error: 'VALIDATION_ERROR', details: err.errors }, { status: 400 });
    throw err;
  }

  const entry = await addToBlocklist(
    input.fingerprintHash,
    input.reason,
    input.blockedBy,
    input.expiresAt ? new Date(input.expiresAt) : null,
    resolvedDeps,
  );
  return NextResponse.json(entry, { status: 201 });
}

export async function DELETE(
  request: NextRequest,
  { deps }: { deps?: DeviceDeps } = {},
): Promise<NextResponse> {
  const resolvedDeps = deps ?? getProductionDeps();

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 });
  }

  let input: z.infer<typeof RemoveSchema>;
  try { input = RemoveSchema.parse(body); } catch (err) {
    if (err instanceof ZodError) return NextResponse.json({ error: 'VALIDATION_ERROR', details: err.errors }, { status: 400 });
    throw err;
  }

  const removed = await removeFromBlocklist(input.fingerprintHash, resolvedDeps);
  if (!removed) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  return NextResponse.json({ removed: true });
}

function getProductionDeps(): DeviceDeps {
  throw new Error('Production dependencies not configured.');
}
