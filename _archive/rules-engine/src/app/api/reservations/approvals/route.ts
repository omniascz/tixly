import { NextRequest, NextResponse } from 'next/server';
import { createApprovalRequest, listPendingApprovals } from '../../../../services/approval.service';
import { isRuleError } from '../../../../lib/rules-errors';

function getDb() {
  return {
    query: async <T>(_sql: string, _params?: unknown[]): Promise<{ rows: T[] }> => ({ rows: [] }),
    execute: async (_sql: string, _params?: unknown[]): Promise<void> => {},
  };
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const promoterId = searchParams.get('promoterId') ?? '';
    const db = getDb();
    const approvals = await listPendingApprovals(promoterId, db);
    return NextResponse.json(approvals);
  } catch (err) {
    if (isRuleError(err)) {
      return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    }
    return NextResponse.json({ error: 'INTERNAL_ERROR', message: 'Unexpected error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const db = getDb();
    const approval = await createApprovalRequest(body, db);
    return NextResponse.json(approval, { status: 201 });
  } catch (err) {
    if (isRuleError(err)) {
      return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    }
    return NextResponse.json({ error: 'INTERNAL_ERROR', message: 'Unexpected error' }, { status: 500 });
  }
}
