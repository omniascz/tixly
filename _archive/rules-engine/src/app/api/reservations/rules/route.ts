import { NextRequest, NextResponse } from 'next/server';
import { createRule, listRules } from '../../../../services/rule.service';
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
    const filters = {
      branchId: searchParams.get('branchId') ?? undefined,
      serviceId: searchParams.get('serviceId') ?? undefined,
      ruleType: (searchParams.get('ruleType') ?? undefined) as Parameters<typeof listRules>[1]['ruleType'],
      isActive: searchParams.has('isActive') ? searchParams.get('isActive') === 'true' : undefined,
    };
    const db = getDb();
    const rules = await listRules(promoterId, filters, db);
    return NextResponse.json(rules);
  } catch (err) {
    if (isRuleError(err)) {
      return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    }
    return NextResponse.json({ error: 'INTERNAL_ERROR', message: 'Unexpected error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const promoterId = searchParams.get('promoterId') ?? '';
    const body = await request.json();
    const db = getDb();
    const rule = await createRule(promoterId, body, db);
    return NextResponse.json(rule, { status: 201 });
  } catch (err) {
    if (isRuleError(err)) {
      return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    }
    return NextResponse.json({ error: 'INTERNAL_ERROR', message: 'Unexpected error' }, { status: 500 });
  }
}
