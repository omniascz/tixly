/**
 * GET    /api/buyer/follows           — list promotérů které buyer sleduje
 * DELETE /api/buyer/follows?promoterId — unfollow konkrétního promotéra
 *
 * Auth: x-user-id (přihlášený buyer). Identifikuje subscriber přes email.
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsUser } from '@/lib/auth';


interface FollowRow {
  subscription_id: string;
  promoter_id: string;
  promoter_name: string;
  promoter_slug: string;
  brand_color_hex: string | null;
  status: string;
  confirmed_at: string | null;
  upcoming_count: string;
}

export async function GET(req: NextRequest): Promise<Response> {
  return runAsUser(req, async (userId) => {
  const r = await db().query<FollowRow>(
    `SELECT ns.id AS subscription_id, p.id AS promoter_id,
            p.name AS promoter_name, p.slug AS promoter_slug,
            p.brand_color_hex, ns.status, ns.confirmed_at,
            (SELECT COUNT(*)::text FROM catalog.events
             WHERE promoter_id = p.id AND status = 'published' AND date_start > now()) AS upcoming_count
     FROM marketing.newsletter_subscribers ns
     JOIN platform.promoters p ON p.id = ns.promoter_id
     JOIN identity.users u ON LOWER(u.email) = LOWER(ns.email)
     WHERE u.id = $1
       AND ns.unsubscribed_at IS NULL
       AND ns.promoter_id IS NOT NULL
     ORDER BY p.name`,
    [userId],
  );

  return NextResponse.json({
    follows: r.rows.map((f) => ({
      subscriptionId: f.subscription_id,
      promoterId: f.promoter_id,
      promoterName: f.promoter_name,
      promoterSlug: f.promoter_slug,
      brandColorHex: f.brand_color_hex,
      status: f.status,
      confirmedAt: f.confirmed_at,
      upcomingCount: Number(f.upcoming_count),
    })),
  });

  });
}

export async function DELETE(req: NextRequest): Promise<Response> {
  return runAsUser(req, async (userId) => {
  const promoterId = req.nextUrl.searchParams.get('promoterId');
  if (!promoterId) {
    return NextResponse.json({ error: 'promoterId required' }, { status: 422 });
  }

  const r = await db().query(
    `UPDATE marketing.newsletter_subscribers ns
       SET unsubscribed_at = now(), status = 'unsubscribed'
     WHERE ns.promoter_id = $1
       AND LOWER(ns.email) = (SELECT LOWER(email) FROM identity.users WHERE id = $2)
       AND ns.unsubscribed_at IS NULL`,
    [promoterId, userId],
  );
  return NextResponse.json({ ok: true, unsubscribed: r.rowCount ?? 0 });

  });
}
