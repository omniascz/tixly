import { NextRequest, NextResponse } from 'next/server';
import { evaluateRules } from '../../../../../services/rule-evaluator.service';
import { isRuleError } from '../../../../../lib/rules-errors';

function getDb() {
  return {
    query: async <T>(_sql: string, _params?: unknown[]): Promise<{ rows: T[] }> => ({ rows: [] }),
    execute: async (_sql: string, _params?: unknown[]): Promise<void> => {},
  };
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const db = getDb();
    const result = await evaluateRules(body, db);
    return NextResponse.json(result);
  } catch (err) {
    if (isRuleError(err)) {
      return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    }
    return NextResponse.json({ error: 'INTERNAL_ERROR', message: 'Unexpected error' }, { status: 500 });
  }
}
