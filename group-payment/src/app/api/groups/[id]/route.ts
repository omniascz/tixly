import { NextRequest, NextResponse } from 'next/server';
import { getGroupPaymentStatus } from '../../../../services/group-payment.service';
import { z } from 'zod';

const deps = {
  db: null as any,
};

const UpdateGroupSchema = z.object({
  strategy: z.enum(['equal', 'proportional', 'custom']).optional(),
});

// GET /api/groups/[id] — get full group state
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const userId = request.headers.get('x-user-id');
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const group = await getGroupPaymentStatus(deps.db, params.id);

    // Check authorization: user is owner or member
    const isMember = group.members.some((m) => m.userId === userId);
    if (group.groupOwnerId !== userId && !isMember) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    return NextResponse.json(group, { status: 200 });
  } catch (err: any) {
    if (err.name === 'GroupPaymentNotFoundError') {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    console.error('Error getting group:', err);
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}

// PATCH /api/groups/[id] — update strategy (only if pending)
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const userId = request.headers.get('x-user-id');
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = UpdateGroupSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  if (!parsed.data.strategy) {
    return NextResponse.json(
      { error: 'No updates provided' },
      { status: 400 },
    );
  }

  try {
    // Get group and verify owner + status
    const group = await getGroupPaymentStatus(deps.db, params.id);

    if (group.groupOwnerId !== userId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    if (group.status !== 'pending') {
      return NextResponse.json(
        { error: 'Can only update strategy while group is pending' },
        { status: 400 },
      );
    }

    // Update strategy
    await deps.db.execute(
      `UPDATE orders.group_payments
       SET splitter_strategy = $1, updated_at = NOW()
       WHERE id = $2`,
      [parsed.data.strategy, params.id],
    );

    // Return updated group
    const updated = await getGroupPaymentStatus(deps.db, params.id);
    return NextResponse.json(updated, { status: 200 });
  } catch (err: any) {
    if (err.name === 'GroupPaymentNotFoundError') {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    console.error('Error updating group:', err);
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
