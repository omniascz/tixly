import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db/rls-pool';

const schema = z.object({
  accountCode: z.string().min(4).max(20),
  email: z.string().email().optional(),
});

export async function POST(req: NextRequest): Promise<Response> {
  const body: unknown = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ valid: false, error: 'INVALID_INPUT' }, { status: 422 });
  }
  const { accountCode, email } = parsed.data;

  const res = await db().query<{
    id: string;
    company_name: string;
    credit_balance_halire: string;
    status: string;
  }>(
    `SELECT id, company_name, credit_balance_halire, status
     FROM platform.b2b_accounts
     WHERE account_code = upper($1) AND status = 'active'`,
    [accountCode],
  );

  if (res.rows.length === 0) {
    return NextResponse.json({ valid: false });
  }

  const account = res.rows[0];

  if (email) {
    const userRes = await db().query<{ id: string }>(
      `SELECT id FROM platform.b2b_account_users
       WHERE account_id = $1 AND lower(email) = lower($2)`,
      [account.id, email],
    );
    if (userRes.rows.length === 0) {
      return NextResponse.json({ valid: false, error: 'EMAIL_NOT_AUTHORIZED' });
    }
  }

  return NextResponse.json({
    valid: true,
    companyName: account.company_name,
    balanceHalire: parseInt(account.credit_balance_halire, 10),
  });
}
