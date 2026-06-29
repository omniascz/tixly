/**
 * GET /api/buyer/loyalty/transactions
 *
 * Paginated seznam loyalty transakcí přihlášeného buyera.
 * ?page=1&limit=20
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<Response> {
  return runAsUser(req, async (userId) => {
    const url = req.nextUrl;
    const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') ?? '20', 10)));
    const offset = (page - 1) * limit;

    const accRes = await db().query<{ id: string }>(
      `SELECT id FROM marketing.loyalty_accounts WHERE user_id = $1`,
      [userId],
    );
    if (accRes.rows.length === 0) {
      return NextResponse.json({ transactions: [], total: 0, page, limit });
    }
    const accountId = accRes.rows[0].id;

    const [txRes, countRes] = await Promise.all([
      db().query<{
        id: string;
        points_delta: number;
        kind: string;
        reason: string | null;
        order_id: string | null;
        expires_at: string | null;
        created_at: string;
      }>(
        `SELECT id, points_delta, kind, reason, order_id, expires_at, created_at
         FROM marketing.loyalty_transactions
         WHERE account_id = $1
         ORDER BY created_at DESC
         LIMIT $2 OFFSET $3`,
        [accountId, limit, offset],
      ),
      db().query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM marketing.loyalty_transactions WHERE account_id = $1`,
        [accountId],
      ),
    ]);

    return NextResponse.json({
      transactions: txRes.rows,
      total: parseInt(countRes.rows[0]?.count ?? '0', 10),
      page,
      limit,
    });
  });
}
