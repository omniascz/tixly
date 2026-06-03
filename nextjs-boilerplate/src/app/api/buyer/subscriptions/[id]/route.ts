/**
 * DELETE /api/buyer/subscriptions/[id]  — cancel at period end (NOT immediate)
 *
 * Buyer ruší své aktivní předplatné. Nemá refund přímý — předplatné zůstává
 * aktivní do konce zakoupené periody (current_period_end), pak se neobnoví.
 *
 * Pokud chce buyer immediate cancel s refundem, kontaktuje promotéra (admin
 * refund flow s prorata kalkulací — TODO).
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsUser } from '@/lib/auth';


export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  return runAsUser(req, async (userId) => {
  const r = await db().query<{ status: string; cancel_at_period_end: boolean }>(
    `UPDATE subscriptions.subscriptions
       SET cancel_at_period_end = true
     WHERE id = $1 AND user_id = $2 AND status = 'active'
     RETURNING status, cancel_at_period_end`,
    [params.id, userId],
  );
  if (r.rows.length === 0) {
    return NextResponse.json({ error: 'NOT_FOUND_OR_INACTIVE' }, { status: 404 });
  }
  return NextResponse.json({ ok: true, cancelAtPeriodEnd: true });

  });
}
