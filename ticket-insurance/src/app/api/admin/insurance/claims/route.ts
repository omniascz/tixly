import { NextRequest, NextResponse } from 'next/server';
import { InsuranceService } from '../../../../../services/insurance.service';
import type { InsuranceDbAdapter } from '../../../../../services/insurance.service';
import { getDbAdapter } from '../../../../../lib/db-adapter';

function getAdminId(request: NextRequest): string | null {
  return request.headers.get('x-admin-id');
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const adminId = getAdminId(request);
  if (!adminId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const db: InsuranceDbAdapter = getDbAdapter();

  try {
    const claims = await InsuranceService.listPendingClaims(adminId, db);
    return NextResponse.json(claims, { status: 200 });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
