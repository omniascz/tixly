import { NextRequest, NextResponse } from 'next/server';
import { inviteMember, getGroupPaymentStatus } from '../../../../../services/group-payment.service';
import { z } from 'zod';

const deps = {
  db: null as any,
  email: { sendGroupInvite: async () => {} },
};

const InviteSchema = z.object({
  toEmail: z.string().email(),
  expiresInDays: z.number().int().min(1).max(365).optional(),
});

// POST /api/groups/[id]/members — invite new member
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const userId = request.headers.get('x-user-id');
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = InviteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const result = await inviteMember(
      deps,
      {
        groupPaymentId: params.id,
        toEmail: parsed.data.toEmail,
        expiresInDays: parsed.data.expiresInDays,
      },
      userId,
    );

    return NextResponse.json(result, { status: 200 });
  } catch (err: any) {
    if (err.name === 'GroupPaymentNotFoundError') {
      return NextResponse.json({ error: 'Group not found' }, { status: 404 });
    }
    if (err.name === 'UnauthorizedGroupPaymentError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (err.name === 'DuplicateGroupMemberError') {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    console.error('Error inviting member:', err);
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
