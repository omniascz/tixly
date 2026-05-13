import { NextRequest, NextResponse } from 'next/server';
import {
  getBalance,
  getTransactionHistory,
} from '../../../../services/credit.service';
import { getServiceDeps } from '../../../../lib/service-container.js';

// ============================================================
// GET /api/referral/credit — wallet balance + transaction history
//
// Requires JWT authentication (x-user-id header set by middleware).
// ============================================================

function getUserId(req: NextRequest): string | null {
  return req.headers.get('x-user-id');
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const userId = getUserId(req);
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { db } = getServiceDeps();

    const [wallet, transactions] = await Promise.all([
      getBalance(userId, db),
      getTransactionHistory(userId, db),
    ]);

    return NextResponse.json({
      wallet: {
        balanceHalire: wallet.balanceHalire,
        lifetimeEarnedHalire: wallet.lifetimeEarnedHalire,
        lifetimeSpentHalire: wallet.lifetimeSpentHalire,
        updatedAt: wallet.updatedAt.toISOString(),
      },
      transactions: transactions.map((tx) => ({
        id: tx.id,
        amountHalire: tx.amountHalire,
        type: tx.type,
        referenceId: tx.referenceId,
        description: tx.description,
        createdAt: tx.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    console.error('[GET /api/referral/credit]', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
