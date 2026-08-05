import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';

const schema = z.object({
  accountCode: z.string().min(4).max(20),
  email: z.string().email().optional(),
});

async function POSTImpl(req: NextRequest): Promise<Response> {
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

// Obaleno servisnim kontextem (FINDINGS 110 / migrace 463).
// B2B identita neni app.current_user_id — autorizace jde pres verifyB2BToken
// a scoping podle session.b2bAccountId zustava v route. Servisni kontext
// drzi rozhodnuti v aplikaci, kde je videt (vzorec 94).

export async function POST(...a: Parameters<typeof POSTImpl>): Promise<Response> {
  return runWithServiceContext(() => POSTImpl(...a));
}
