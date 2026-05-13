import { NextRequest, NextResponse } from 'next/server';
import {
  spendCredit,
  getBalance,
  getMaxCreditDiscount,
} from '../../../../../services/credit.service';
import { InsufficientCreditError } from '../../../../../types/referral.types';
import { getServiceDeps } from '../../../../../lib/service-container.js';

// ============================================================
// POST /api/referral/credit/apply — apply credit discount to an order
//
// Requires JWT authentication (x-user-id header set by middleware).
// Body: { orderId: string; amountHalire: number; orderTotalHalire: number }
// Všechny peněžní hodnoty jsou v INTEGER haléřích.
// ============================================================

function getUserId(req: NextRequest): string | null {
  return req.headers.get('x-user-id');
}

interface ApplyBody {
  orderId: string;
  amountHalire: number;
  orderTotalHalire: number; // needed to enforce the 20% cap
}

function isPositiveInt(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n > 0;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const userId = getUserId(req);
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: Partial<ApplyBody>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { orderId, amountHalire, orderTotalHalire } = body;

  if (typeof orderId !== 'string' || orderId.length === 0) {
    return NextResponse.json({ error: 'Missing orderId' }, { status: 400 });
  }
  if (!isPositiveInt(amountHalire)) {
    return NextResponse.json(
      { error: 'amountHalire must be a positive integer (haléře)' },
      { status: 400 },
    );
  }
  if (!isPositiveInt(orderTotalHalire)) {
    return NextResponse.json(
      { error: 'orderTotalHalire must be a positive integer (haléře)' },
      { status: 400 },
    );
  }

  try {
    const { db } = getServiceDeps();
    const wallet = await getBalance(userId, db);

    // Enforce the 20% of order value cap
    const maxAllowed = getMaxCreditDiscount(orderTotalHalire, wallet.balanceHalire);
    if (amountHalire > maxAllowed) {
      return NextResponse.json(
        {
          error: `Requested credit (${amountHalire} haléřů) exceeds the allowed maximum of ${maxAllowed} haléřů (20 % of order or available balance)`,
          maxAllowedHalire: maxAllowed,
        },
        { status: 422 },
      );
    }

    await spendCredit(userId, amountHalire, orderId, db);

    // Return refreshed balance
    const updated = await getBalance(userId, db);

    return NextResponse.json({
      success: true,
      appliedHalire: amountHalire,
      newBalanceHalire: updated.balanceHalire,
    });
  } catch (err) {
    if (err instanceof InsufficientCreditError) {
      return NextResponse.json(
        { error: err.message },
        { status: 422 },
      );
    }
    console.error('[POST /api/referral/credit/apply]', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
