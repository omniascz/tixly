/**
 * GET /api/platform/postal?status=pending — fulfillment queue
 */
import { NextRequest, NextResponse } from 'next/server';
import { db, runWithPlatformAdminContext } from '@/lib/db/rls-pool';
import { requirePlatformAdmin } from '@/lib/platform-auth';

export async function GET(req: NextRequest): Promise<Response> {
  const admin = await requirePlatformAdmin(req);
  if (!admin) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });

  const status = req.nextUrl.searchParams.get('status') ?? 'pending';
  // Platformni data — bez app.is_platform_admin RLS odfiltruje vse.
  // POZOR: pod admin kontextem RLS uz nefiltruje podle tenanta, filtruje dotaz.
  return runWithPlatformAdminContext(async () => {
    const client = await db().connect();
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL app.is_platform_admin = 'true'`);
      const r = await client.query(
        `SELECT pd.*, e.title AS event_title, u.email AS buyer_email
           FROM orders.postal_deliveries pd
           JOIN orders.orders o ON o.id = pd.order_id
           JOIN catalog.events e ON e.id = o.event_id
           JOIN identity.users u ON u.id = o.user_id
          WHERE pd.status = $1
          ORDER BY pd.created_at ASC
          LIMIT 200`,
        [status],
      );
      await client.query('COMMIT');
      return NextResponse.json({ deliveries: r.rows });
    } finally {
      client.release();
    }
  });
}
