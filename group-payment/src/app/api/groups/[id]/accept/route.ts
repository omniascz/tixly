import { NextRequest, NextResponse } from 'next/server';
import { acceptInvite } from '../../../../../services/group-payment.service';
import { z } from 'zod';

const deps = {
  db: null as any,
};

const AcceptSchema = z.object({
  token: z.string().min(32),
  orderId: z.string().min(1).max(100),
});

// POST /api/groups/[id]/accept — accept invite and join group
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const userId = request.headers.get('x-user-id');
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = AcceptSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const member = await acceptInvite(deps, {
      token: parsed.data.token,
      userId,
      orderId: parsed.data.orderId,
    });

    return NextResponse.json(member, { status: 200 });
  } catch (err: any) {
    if (err.name === 'GroupPaymentInviteNotFoundError') {
      return NextResponse.json({ error: 'Invalid invite token' }, { status: 404 });
    }
    if (err.name === 'GroupPaymentInviteExpiredError') {
      return NextResponse.json({ error: 'Invite has expired' }, { status: 410 });
    }
    if (err.name === 'DuplicateGroupMemberError') {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    if (err.name === 'GroupPaymentNotFoundError') {
      return NextResponse.json({ error: 'Group not found' }, { status: 404 });
    }
    console.error('Error accepting invite:', err);
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
