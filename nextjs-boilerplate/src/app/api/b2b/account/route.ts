import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';

function getSecretKey(): Uint8Array {
  let secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('JWT_SECRET missing or too short in production');
    }
    secret = 'dev-secret-change-me-min-32-chars-please';
  }
  return new TextEncoder().encode(secret);
}

async function verifyB2BToken(req: NextRequest): Promise<{
  b2bAccountId: string;
  b2bUserId: string;
  isAdmin: boolean;
} | null> {
  const auth = req.headers.get('authorization');
  const token = auth?.toLowerCase().startsWith('bearer ') ? auth.slice(7) : null;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getSecretKey());
    const p = payload as { b2bAccountId?: string; b2bUserId?: string; isAdmin?: boolean };
    if (!p.b2bAccountId || !p.b2bUserId) return null;
    return { b2bAccountId: p.b2bAccountId, b2bUserId: p.b2bUserId, isAdmin: p.isAdmin ?? false };
  } catch {
    return null;
  }
}

async function GETImpl(req: NextRequest): Promise<Response> {
  const session = await verifyB2BToken(req);
  if (!session) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  const accountRes = await db().query<{
    id: string;
    company_name: string;
    ico: string;
    contact_email: string;
    account_code: string;
    credit_balance_halire: string;
    monthly_limit_halire: string | null;
    status: string;
  }>(
    `SELECT id, company_name, ico, contact_email, account_code,
            credit_balance_halire, monthly_limit_halire, status
     FROM platform.b2b_accounts
     WHERE id = $1`,
    [session.b2bAccountId],
  );

  if (accountRes.rows.length === 0) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }

  const now = new Date();
  const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  const spentRes = await db().query<{ spent: string }>(
    `SELECT COALESCE(SUM(ABS(amount_halire)), 0) AS spent
     FROM platform.b2b_transactions
     WHERE account_id = $1 AND type = 'purchase' AND created_at >= $2`,
    [session.b2bAccountId, firstOfMonth],
  );

  const txRes = await db().query(
    `SELECT bt.id, bt.type, bt.amount_halire, bt.balance_after, bt.note, bt.created_at,
            bau.email AS user_email, bau.name AS user_name
     FROM platform.b2b_transactions bt
     LEFT JOIN platform.b2b_account_users bau ON bau.id = bt.user_id
     WHERE bt.account_id = $1
     ORDER BY bt.created_at DESC
     LIMIT 100`,
    [session.b2bAccountId],
  );

  let users: unknown[] = [];
  if (session.isAdmin) {
    const usersRes = await db().query(
      `SELECT id, email, name, monthly_limit_halire, is_admin, joined_at, created_at
       FROM platform.b2b_account_users
       WHERE account_id = $1
       ORDER BY created_at`,
      [session.b2bAccountId],
    );
    users = usersRes.rows;
  }

  return NextResponse.json({
    account: accountRes.rows[0],
    spentThisMonthHalire: parseInt(spentRes.rows[0].spent, 10),
    transactions: txRes.rows,
    users,
    isAdmin: session.isAdmin,
  });
}

// Obaleno servisnim kontextem (FINDINGS 110 / migrace 463).
// B2B identita neni app.current_user_id — autorizace jde pres verifyB2BToken
// a scoping podle session.b2bAccountId zustava v route. Servisni kontext
// drzi rozhodnuti v aplikaci, kde je videt (vzorec 94).

export async function GET(...a: Parameters<typeof GETImpl>): Promise<Response> {
  return runWithServiceContext(() => GETImpl(...a));
}
