/**
 * GET /api/public/tickets/[ticketId]/wallet-content
 *
 * Vrátí aktivní wallet content modules pro lock-screen rendering.
 * Filtruje podle publish_at/expires_at + TM "3 days before event" rule.
 */
import { NextRequest, NextResponse } from 'next/server';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';


export async function GET(
  _req: NextRequest,
  { params }: { params: { ticketId: string } },
): Promise<Response> {
  return runWithServiceContext(async () => {

  const r = await db().query<{
    module_type: string;
    title: string;
    content: string | null;
    link_url: string | null;
    icon: string | null;
    display_order: number;
  }>(
    `SELECT wcm.module_type, wcm.title, wcm.content, wcm.link_url, wcm.icon, wcm.display_order
       FROM tickets.wallet_content_modules wcm
       JOIN tickets.tickets t ON t.id = $1
       JOIN orders.orders o ON o.id = t.order_id
      WHERE wcm.event_id = o.event_id
        AND wcm.is_active = true
        AND wcm.publish_at <= now()
        AND (wcm.expires_at IS NULL OR wcm.expires_at > now())
   ORDER BY wcm.display_order, wcm.created_at`,
    [params.ticketId],
  );

  return NextResponse.json({ modules: r.rows });

  });
}
