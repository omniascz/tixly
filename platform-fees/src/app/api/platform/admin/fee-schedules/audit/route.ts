import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getFeeScheduleAuditLog } from '../../../../../../services/fee.service.js';
import { FeeError } from '../../../../../../lib/fee-errors.js';
import type { ServiceDeps } from '../../../../../../lib/service-container.js';

// ---------------------------------------------------------------------------
// Deps factory — přepsatelná v testech
// ---------------------------------------------------------------------------
export let _getDeps: () => ServiceDeps = () => {
  throw new Error('DB adapter not configured — inject via _getDeps');
};

export function _setDeps(factory: () => ServiceDeps): void {
  _getDeps = factory;
}

// ---------------------------------------------------------------------------
// GET /api/platform/admin/fee-schedules/audit?promoterId=&limit=&offset=
// ---------------------------------------------------------------------------
export async function GET(request: NextRequest): Promise<NextResponse> {
  const adminUserId = request.headers.get('x-admin-user-id');
  if (!adminUserId) {
    return NextResponse.json(
      { error: { code: 'UNAUTHORIZED', message: 'Chybí x-admin-user-id header.' } },
      { status: 401 },
    );
  }

  const { searchParams } = new URL(request.url);
  const promoterId = searchParams.get('promoterId');
  const limitRaw = searchParams.get('limit');
  const offsetRaw = searchParams.get('offset');

  const promoterIdResult = z.string().uuid().safeParse(promoterId);
  if (!promoterIdResult.success) {
    return NextResponse.json(
      { error: { code: 'VALIDATION_ERROR', message: 'Parametr promoterId musí být platné UUID.' } },
      { status: 400 },
    );
  }

  const limit = limitRaw !== null ? parseInt(limitRaw, 10) : undefined;
  const offset = offsetRaw !== null ? parseInt(offsetRaw, 10) : undefined;

  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
    return NextResponse.json(
      { error: { code: 'VALIDATION_ERROR', message: 'Parametr limit musí být kladné celé číslo.' } },
      { status: 400 },
    );
  }

  if (offset !== undefined && (!Number.isInteger(offset) || offset < 0)) {
    return NextResponse.json(
      { error: { code: 'VALIDATION_ERROR', message: 'Parametr offset musí být nezáporné celé číslo.' } },
      { status: 400 },
    );
  }

  try {
    const result = await getFeeScheduleAuditLog(
      promoterIdResult.data,
      { limit, offset },
      _getDeps(),
    );
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    if (err instanceof FeeError) {
      return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    }
    throw err;
  }
}
