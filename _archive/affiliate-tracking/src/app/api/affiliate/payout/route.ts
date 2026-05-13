import { NextRequest, NextResponse } from 'next/server';
import { requestPayout } from '../../../../services/affiliate.service';
import { AffiliateNotActiveError, PayoutThresholdNotReachedError } from '../../../../types/affiliate.types';

const deps = { db: null as any, kafka: { send: async () => {} } };

export async function POST(request: NextRequest) {
  const userId = request.headers.get('x-user-id');
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { affiliateId } = await request.json().catch(() => ({}));
  if (!affiliateId) return NextResponse.json({ error: 'affiliateId required' }, { status: 400 });

  try {
    const payout = await requestPayout(deps, affiliateId, userId);
    return NextResponse.json(payout, { status: 201 });
  } catch (err) {
    if (err instanceof PayoutThresholdNotReachedError) {
      return NextResponse.json({
        error: err.message,
        currentBalance: err.currentBalance,
        threshold: err.threshold,
      }, { status: 422 });
    }
    if (err instanceof AffiliateNotActiveError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    throw err;
  }
}
