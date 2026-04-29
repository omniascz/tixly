import { NextRequest, NextResponse } from 'next/server';
import { createGroupPayment, getGroupPaymentStatus } from '../../../services/group-payment.service';
import { z } from 'zod';

// Mock dependencies - would be injected in real app
const deps = {
  db: null as any,
  email: { sendGroupInvite: async () => {} },
};

const CreateGroupSchema = z.object({
  eventId: z.string().min(1).max(100),
  strategy: z.enum(['equal', 'proportional', 'custom']),
  orderIds: z.array(z.string()).min(1).max(10),
  memberEmails: z.array(z.string().email()).min(1).max(20),
});

// POST /api/groups — create new group payment
export async function POST(request: NextRequest) {
  const userId = request.headers.get('x-user-id');
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = CreateGroupSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const result = await createGroupPayment(deps, userId, parsed.data);
    return NextResponse.json(result, { status: 201 });
  } catch (err: any) {
    console.error('Error creating group payment:', err);
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}

// GET /api/groups — list groups for current user (owner or member)
export async function GET(request: NextRequest) {
  const userId = request.headers.get('x-user-id');
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    // Get groups where user is owner
    const ownedGroups = await deps.db.query(
      `SELECT id, group_owner_id, event_id, total_amount_halire, splitter_strategy, status, created_at
       FROM orders.group_payments WHERE group_owner_id = $1
       ORDER BY created_at DESC`,
      [userId],
    );

    // Get groups where user is member
    const memberGroups = await deps.db.query(
      `SELECT gp.id, gp.group_owner_id, gp.event_id, gp.total_amount_halire,
              gp.splitter_strategy, gp.status, gp.created_at
       FROM orders.group_payments gp
       JOIN orders.group_members gm ON gp.id = gm.group_payment_id
       WHERE gm.user_id = $1
       ORDER BY gp.created_at DESC`,
      [userId],
    );

    // Combine and deduplicate
    const allGroups = [...ownedGroups, ...memberGroups];
    const uniqueGroupIds = new Set();
    const groups = allGroups.filter((g) => {
      if (uniqueGroupIds.has(g.id)) return false;
      uniqueGroupIds.add(g.id);
      return true;
    });

    return NextResponse.json(groups, { status: 200 });
  } catch (err: any) {
    console.error('Error listing groups:', err);
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
