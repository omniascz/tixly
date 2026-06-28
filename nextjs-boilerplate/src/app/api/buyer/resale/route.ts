/**
 * GET /api/buyer/resale  — seller's own listings
 */

import { NextRequest, NextResponse } from 'next/server';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';
import { runAsUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<Response> {
  return runAsUser(req, async (userId) => {
    const listings = await runWithServiceContext(() =>
      db().query(
        `SELECT l.*,
                e.title AS event_title,
                e.start_date,
                e.slug  AS event_slug
         FROM orders.resale_listings l
         JOIN catalog.events e ON e.id = l.event_id
         WHERE l.seller_user_id = $1
         ORDER BY l.listed_at DESC
         LIMIT 100`,
        [userId],
      ),
    );

    return NextResponse.json({ listings: listings.rows });
  });
}
