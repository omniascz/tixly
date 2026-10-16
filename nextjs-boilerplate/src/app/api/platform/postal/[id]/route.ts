/**
 * PATCH /api/platform/postal/[id] — update delivery status
 */
import { NextRequest, NextResponse } from 'next/server';
import { db, runWithPlatformAdminContext } from '@/lib/db/rls-pool';
import { requirePlatformAdmin } from '@/lib/platform-auth';

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }): Promise<Response> {
  const params = await props.params;
  const admin = await requirePlatformAdmin(req);
  if (!admin) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });

  let body: { status?: string; trackingNumber?: string; carrier?: string };
  try { body = (await req.json()) as typeof body; } catch {
    return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 });
  }

  const validStatuses = ['pending', 'dispatched', 'delivered', 'returned'];
  if (body.status && !validStatuses.includes(body.status)) {
    return NextResponse.json({ error: 'INVALID_STATUS' }, { status: 422 });
  }

  // Platformni data — bez app.is_platform_admin RLS odfiltruje vse.
  // POZOR: pod admin kontextem RLS uz nefiltruje podle tenanta, filtruje dotaz.
  return runWithPlatformAdminContext(async () => {
    const client = await db().connect();
    try {
      await client.query('BEGIN');
      // Kolo 3: admin kontext nastavuje runWithPlatformAdminContext (admin ověřen requirePlatformAdmin) — inline SET byl duplicitní.
      await client.query(
        `UPDATE orders.postal_deliveries
            SET status = COALESCE($1, status),
                tracking_number = COALESCE($2, tracking_number),
                carrier = COALESCE($3, carrier),
                dispatched_at = CASE WHEN $1='dispatched' AND dispatched_at IS NULL THEN now() ELSE dispatched_at END,
                updated_at = now()
          WHERE id = $4`,
        [body.status ?? null, body.trackingNumber ?? null, body.carrier ?? null, params.id],
      );
      await client.query('COMMIT');
      return NextResponse.json({ updated: true });
    } finally {
      client.release();
    }
  });
}
