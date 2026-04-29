import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { CreateFeeScheduleSchema } from '../../../../../lib/zod-schemas';
import { createFeeSchedule, listFeeSchedules } from '../../../../../services/fee.service';
import { FeeError } from '../../../../../lib/fee-errors';
import type { ServiceDeps } from '../../../../../lib/service-container';

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
// GET /api/platform/admin/fee-schedules?promoterId=...
// ---------------------------------------------------------------------------
export async function GET(request: NextRequest): Promise<NextResponse> {
  const adminUserId = request.headers.get('x-admin-user-id');
  if (!adminUserId) {
    return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Chybí x-admin-user-id header.' } }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const promoterId = searchParams.get('promoterId');

  const promoterIdResult = z.string().uuid().safeParse(promoterId);
  if (!promoterIdResult.success) {
    return NextResponse.json(
      { error: { code: 'VALIDATION_ERROR', message: 'Parametr promoterId musí být platné UUID.' } },
      { status: 400 },
    );
  }

  try {
    const schedules = await listFeeSchedules(promoterIdResult.data, _getDeps());
    return NextResponse.json(schedules, { status: 200 });
  } catch (err) {
    if (err instanceof FeeError) {
      return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// POST /api/platform/admin/fee-schedules
// ---------------------------------------------------------------------------
export async function POST(request: NextRequest): Promise<NextResponse> {
  const adminUserId = request.headers.get('x-admin-user-id');
  if (!adminUserId) {
    return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Chybí x-admin-user-id header.' } }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: { code: 'INVALID_JSON', message: 'Tělo požadavku není platný JSON.' } }, { status: 400 });
  }

  const parseResult = CreateFeeScheduleSchema.safeParse(body);
  if (!parseResult.success) {
    return NextResponse.json(
      { error: { code: 'VALIDATION_ERROR', message: parseResult.error.errors[0]?.message ?? 'Neplatná data.' } },
      { status: 400 },
    );
  }

  const { promoterId, ...rest } = parseResult.data;

  try {
    const schedule = await createFeeSchedule(promoterId, { promoterId, ...rest }, adminUserId, _getDeps());
    return NextResponse.json(schedule, { status: 201 });
  } catch (err) {
    if (err instanceof FeeError) {
      return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    }
    throw err;
  }
}
