import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsUser } from '@/lib/auth';

interface MembershipRow {
  id: string;
  membership_code: string;
  status: string;
  valid_until: string | null;
  bundle_id: string;
  bundle_name: string;
  card_color: string | null;
  card_issued_at: string | null;
}

export async function GET(req: NextRequest): Promise<Response> {
  return runAsUser(req, async (userId) => {
    const r = await db().query<MembershipRow>(
      `SELECT m.id, m.membership_code, m.status, m.valid_until, m.card_issued_at,
              b.id AS bundle_id, b.name AS bundle_name, b.card_color
       FROM tickets.cross_pass_memberships m
       JOIN catalog.cross_pass_bundles b ON b.id = m.bundle_id
       WHERE m.user_id = $1
       ORDER BY m.created_at DESC`,
      [userId],
    );

    return NextResponse.json({ memberships: r.rows });
  });
}
