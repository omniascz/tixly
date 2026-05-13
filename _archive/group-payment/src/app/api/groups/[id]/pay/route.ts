import { NextRequest, NextResponse } from 'next/server';
import { recordMemberPayment, getGroupPaymentStatus } from '../../../../../services/group-payment.service';
import { z } from 'zod';

const deps = {
  db: null as any,
  email: { sendGroupInvite: async () => {} },
};

const PaySchema = z.object({
  amount: z.number().int().min(1),
});

// POST /api/groups/[id]/pay — record payment from current user
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const userId = request.headers.get('x-user-id');
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = PaySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    // Record the payment
    const memberStatus = await recordMemberPayment(deps, {
      groupPaymentId: params.id,
      userId,
      amountPaidHalire: parsed.data.amount,
    });

    // Get updated group status
    const groupStatus = await getGroupPaymentStatus(deps.db, params.id);

    return NextResponse.json(
      {
        memberStatus,
        groupStatus,
      },
      { status: 200 },
    );
  } catch (err: any) {
    console.error('Error recording payment:', err);
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
