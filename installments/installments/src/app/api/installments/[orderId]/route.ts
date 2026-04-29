// GET /api/installments/[orderId]
// Returns the installment schedule for an order.
// Accessible to the ticket owner or an organizer (x-user-role: organizer).

import { NextRequest, NextResponse } from 'next/server';
import { InstallmentService } from '../../../../services/installment.service';
import {
  toInstallmentHttpError,
  InstallmentScheduleNotFoundError,
} from '../../../../types/installment.types';
import type { InstallmentDbAdapter } from '../../../../services/installment.service';

// ---------------------------------------------------------------------------
// Adapter stub — replace with real DB adapter wired to your data layer.
// ---------------------------------------------------------------------------

function getDbAdapter(): InstallmentDbAdapter {
  // Production: return new PostgresInstallmentAdapter(pool);
  throw new Error('InstallmentDbAdapter not configured. Wire a real DB adapter here.');
}

// ---------------------------------------------------------------------------
// GET /api/installments/[orderId]
// ---------------------------------------------------------------------------

export async function GET(
  request: NextRequest,
  { params }: { params: { orderId: string } },
): Promise<NextResponse> {
  const userId = request.headers.get('x-user-id');
  const userRole = request.headers.get('x-user-role');

  if (!userId) {
    return NextResponse.json(
      { error: 'Unauthorized', code: 'UNAUTHORIZED' },
      { status: 401 },
    );
  }

  try {
    const db = getDbAdapter();
    const service = new InstallmentService();
    const schedule = await service.getScheduleStatus(params.orderId, db);

    // Authorization: owner or organizer.
    const isOwner = schedule.user_id === userId;
    const isOrganizer = userRole === 'organizer';

    if (!isOwner && !isOrganizer) {
      return NextResponse.json(
        { error: 'Forbidden', code: 'FORBIDDEN' },
        { status: 403 },
      );
    }

    return NextResponse.json(schedule, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (err) {
    if (err instanceof InstallmentScheduleNotFoundError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: 404 },
      );
    }
    const { status, body } = toInstallmentHttpError(err);
    return NextResponse.json(body, { status });
  }
}
