import { NextRequest, NextResponse } from 'next/server';
import { createRule, listRules } from '../../../../services/age-restriction.service';
import { isCinemaProgramError } from '../../../../lib/cinema-program-errors';

function getDb() {
  return {
    query: async <T>(_sql: string, _params?: unknown[]): Promise<{ rows: T[] }> => ({ rows: [] }),
    execute: async (_sql: string, _params?: unknown[]): Promise<void> => {},
  };
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const promoterId = searchParams.get('promoterId');
    if (!promoterId) {
      return NextResponse.json({ error: 'VALIDATION_ERROR', message: 'promoterId is required' }, { status: 400 });
    }
    const db = getDb();
    const rules = await listRules(promoterId, db);
    return NextResponse.json({ rules });
  } catch (err) {
    if (isCinemaProgramError(err)) {
      return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    }
    return NextResponse.json({ error: 'INTERNAL_ERROR', message: 'Unexpected error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { promoterId: string; rating: string; minAge: number; [key: string]: unknown };
    const { promoterId, rating, ...input } = body;
    const db = getDb();
    const rule = await createRule(promoterId, rating, input as Parameters<typeof createRule>[2], db);
    return NextResponse.json(rule, { status: 201 });
  } catch (err) {
    if (isCinemaProgramError(err)) {
      return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    }
    return NextResponse.json({ error: 'INTERNAL_ERROR', message: 'Unexpected error' }, { status: 500 });
  }
}
