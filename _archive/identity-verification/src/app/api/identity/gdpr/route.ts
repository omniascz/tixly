import { NextRequest, NextResponse } from 'next/server';
import { exportUserData, eraseUserData } from '../../../../services/gdpr.service.js';
import type { IdentityDeps } from '../../../../services/bankid.service.js';

// GET /api/identity/gdpr — GDPR data export (subject access request)
export async function GET(
  request: NextRequest,
  { deps }: { deps?: IdentityDeps } = {},
): Promise<NextResponse> {
  const resolvedDeps = deps ?? getProductionDeps();
  const userId = request.headers.get('x-user-id');
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const data = await exportUserData(userId, resolvedDeps);
  return NextResponse.json(data);
}

// DELETE /api/identity/gdpr — GDPR right to erasure
export async function DELETE(
  request: NextRequest,
  { deps }: { deps?: IdentityDeps } = {},
): Promise<NextResponse> {
  const resolvedDeps = deps ?? getProductionDeps();
  const userId = request.headers.get('x-user-id');
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const result = await eraseUserData(userId, resolvedDeps);
  return NextResponse.json(result);
}

function getProductionDeps(): IdentityDeps {
  throw new Error('Production dependencies not configured.');
}
