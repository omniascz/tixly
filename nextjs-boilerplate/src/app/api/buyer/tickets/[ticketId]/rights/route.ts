/**
 * GET /api/buyer/tickets/[ticketId]/rights
 *
 * Vrátí AKTIVNÍ programmable rights lístku (časovaný kredit / auto-přeprodej při
 * no-show / podmíněný upgrade) — vyhodnocené rights-enginem podle času, skenu a
 * naplněnosti akce. Read-only: nemění lístek ani nákup.
 */
import { NextRequest, NextResponse } from 'next/server';
import { runAsUser } from '@/lib/auth';
import { db } from '@/lib/db/rls-pool';
import { evaluateRights, type ProgrammableRights } from '@/lib/rights/engine';

export async function GET(req: NextRequest, props: { params: Promise<{ ticketId: string }> }): Promise<Response> {
  const params = await props.params;
  return runAsUser(req, async (userId) => {
    if (!/^[0-9a-f-]{36}$/i.test(params.ticketId)) {
      return NextResponse.json({ error: 'INVALID_ID' }, { status: 422 });
    }

    // Vlastnictví + potřebná data v jednom dotazu. programmable_rights čteme přes
    // to_jsonb (migračně bezpečné napříč prostředími).
    const r = await db().query<{
      programmable_rights: ProgrammableRights | null;
      date_start: string;
      scanned_at: string | null;
      cap_total: number | null;
      cap_sold: number | null;
    }>(
      `SELECT (to_jsonb(tt.*) -> 'programmable_rights') AS programmable_rights,
              e.date_start::text AS date_start,
              (SELECT MIN(se.scanned_at)::text FROM tickets.scan_events se WHERE se.ticket_id = t.id) AS scanned_at,
              (SELECT COALESCE(SUM(total_qty), 0) FROM catalog.ticket_types WHERE event_id = e.id) AS cap_total,
              (SELECT COUNT(*) FROM tickets.tickets tk
                 JOIN orders.orders oo ON oo.id = tk.order_id
                WHERE oo.event_id = e.id AND oo.status = 'paid') AS cap_sold
         FROM tickets.tickets t
         JOIN orders.orders o ON o.id = t.order_id
         JOIN catalog.ticket_types tt ON tt.id = t.ticket_type_id
         JOIN catalog.events e ON e.id = o.event_id
        WHERE t.id = $1 AND (t.owner_id = $2 OR o.user_id = $2)`,
      [params.ticketId, userId],
    );
    if (r.rows.length === 0) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    const row = r.rows[0];

    const capacityPct =
      row.cap_total && row.cap_total > 0 ? Number(row.cap_sold ?? 0) / Number(row.cap_total) : null;

    const rights = evaluateRights(row.programmable_rights, {
      now: new Date(),
      scannedAt: row.scanned_at ? new Date(row.scanned_at) : null,
      eventStart: new Date(row.date_start),
      capacityPct,
    });

    return NextResponse.json({ rights });
  });
}
