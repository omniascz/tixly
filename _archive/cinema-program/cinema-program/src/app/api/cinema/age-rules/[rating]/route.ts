import { NextRequest, NextResponse } from 'next/server';
import { getRule, updateRule } from '../../../../../services/age-restriction.service';
import { isCinemaProgramError } from '../../../../../lib/cinema-program-errors';

function getDb() {
  return {
    query: async <T>(_sql: string, _params?: unknown[]): Promise<{ rows: T[] }> => ({ rows: [] }),
    execute: async (_sql: string, _params?: unknown[]): Promise<void> => {},
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: { rating: string } },
) {
  try {
    const { searchParams } = new URL(request.url);
    const promoterId = searchParams.get('promoterId');
    if (!promoterId) {
      return NextResponse.json({ error: 'VALIDATION_ERROR', message: 'promoterId is required' }, { status: 400 });
    }
    const db = getDb();
    const rule = await getRule(promoterId, params.rating, db);
    if (!rule) {
      return NextResponse.json({ error: 'RULE_NOT_FOUND', message: 'Age restriction rule not found.' }, { status: 404 });
    }
    return NextResponse.json(rule);
  } catch (err) {
    if (isCinemaProgramError(err)) {
      return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    }
    return NextResponse.json({ error: 'INTERNAL_ERROR', message: 'Unexpected error' }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { rating: string } },
) {
  try {
    const body = await request.json() as { promoterId: string; [key: string]: unknown };
    const { promoterId, ...input } = body;
    const db = getDb();
    const rule = await updateRule(promoterId, params.rating, input as Parameters<typeof updateRule>[2], db);
    return NextResponse.json(rule);
  } catch (err) {
    if (isCinemaProgramError(err)) {
      return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    }
    return NextResponse.json({ error: 'INTERNAL_ERROR', message: 'Unexpected error' }, { status: 500 });
  }
}
