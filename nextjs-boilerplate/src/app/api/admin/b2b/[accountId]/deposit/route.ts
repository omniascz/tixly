import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requirePlatformAdmin } from '@/lib/platform-auth';
import { db, runWithPlatformAdminContext } from '@/lib/db/rls-pool';

const schema = z.object({
  amountHalire: z.number().int().positive(),
  note: z.string().max(500).optional(),
});

async function POSTImpl(
  req: NextRequest,
  { params }: { params: Promise<{ accountId: string }> },
): Promise<Response> {
  const admin = await requirePlatformAdmin(req);
  if (!admin) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  const { accountId } = await params;

  const body: unknown = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'VALIDATION_FAILED', issues: parsed.error.issues }, { status: 422 });
  }
  const { amountHalire, note } = parsed.data;

  const client = await db().connect();
  try {
    await client.query('BEGIN');

    await client.query(
      `UPDATE platform.b2b_accounts
       SET credit_balance_halire = credit_balance_halire + $2
       WHERE id = $1`,
      [accountId, amountHalire],
    );

    const balRes = await client.query<{ credit_balance_halire: string }>(
      `SELECT credit_balance_halire FROM platform.b2b_accounts WHERE id = $1`,
      [accountId],
    );
    if (balRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    }
    const newBalance = parseInt(balRes.rows[0].credit_balance_halire, 10);

    const txRes = await client.query<{ id: string }>(
      `INSERT INTO platform.b2b_transactions
         (account_id, type, amount_halire, balance_after, note)
       VALUES ($1, 'deposit', $2, $3, $4)
       RETURNING id`,
      [accountId, amountHalire, newBalance, note ?? null],
    );

    await client.query('COMMIT');
    return NextResponse.json({ newBalance, transactionId: txRes.rows[0].id });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[b2b/deposit]', err);
    return NextResponse.json({ error: 'INTERNAL_SERVER_ERROR' }, { status: 500 });
  } finally {
    client.release();
  }
}

// Obaleno kontextem platform admina (FINDINGS 110 / migrace 463).
// requirePlatformAdmin OVERUJE, ale GUC NENASTAVUJE — to dela az
// runAsPlatformAdmin (platform-auth.ts:55). Bez tohohle obaleni by 463
// spravu B2B uctu zavrela: app.is_platform_admin by nebylo nastavene
// a vetev app_is_platform_admin() by neplatila. Zmereno, ne odhadnuto.

export async function POST(...a: Parameters<typeof POSTImpl>): Promise<Response> {
  return runWithPlatformAdminContext(() => POSTImpl(...a));
}
