/**
 * GET /api/admin/events/[id]/occupancy
 *
 * Kolik lidí je právě uvnitř.
 *
 * Sloupec `currently_inside` se do srpna 2026 zapisoval při každém průchodu,
 * ale **nikde se nečetl** — v celém repozitáři nebyl jediný dotaz. Přitom je to
 * údaj, který produkce u dveří potřebuje nejvíc: kapacitní limit, požární
 * bezpečnost a rozhodnutí, jestli se dá pustit další skupina.
 *
 * Vrací i rozpad podle bran, aby bylo vidět, kudy lidé chodí, a poslední
 * průchody pro rychlou kontrolu, že skenování běží.
 */

import { NextRequest, NextResponse } from 'next/server';
import { runAsPromoter } from '@/lib/admin-auth';
import { db } from '@/lib/db/rls-pool';

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  return runAsPromoter(req, async (ctx) => {
    if (!/^[0-9a-f-]{36}$/i.test(params.id)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const ev = await db().query<{
      capacity: number | null;
      reentry_allowed: boolean;
      title: string;
    }>(
      `SELECT v.capacity, e.reentry_allowed, e.title
       FROM catalog.events e
       LEFT JOIN catalog.venues v ON v.id = e.venue_id
       WHERE e.id = $1 AND e.promoter_id = $2`,
      [params.id, ctx.promoterId],
    );
    if (ev.rows.length === 0) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const counts = await db().query<{
      inside: string;
      admitted_ever: string;
      sold: string;
    }>(
      `SELECT
         COUNT(*) FILTER (WHERE tk.currently_inside)::text        AS inside,
         COUNT(*) FILTER (WHERE tk.scan_count > 0)::text          AS admitted_ever,
         COUNT(*)::text                                           AS sold
       FROM tickets.tickets tk
       JOIN orders.orders o ON o.id = tk.order_id
       WHERE o.event_id = $1 AND tk.revoked_at IS NULL AND o.status IN ('paid','completed')`,
      [params.id],
    );
    const c = counts.rows[0];
    const inside = Number(c?.inside ?? 0);
    const admittedEver = Number(c?.admitted_ever ?? 0);
    const sold = Number(c?.sold ?? 0);

    // Průchody za poslední hodinu po bránách — ukazuje, kudy se chodí
    // a jestli některá brána nepřestala skenovat.
    const gates = await db().query<{
      gate_label: string | null;
      entries: string;
      exits: string;
    }>(
      `SELECT COALESCE(g.label, 'bez brány') AS gate_label,
              COUNT(*) FILTER (WHERE se.scan_type IN ('entry','reentry'))::text AS entries,
              COUNT(*) FILTER (WHERE se.scan_type = 'exit')::text               AS exits
       FROM tickets.scan_events se
       LEFT JOIN catalog.venue_gates g ON g.id = se.gate_id
       WHERE se.event_id = $1
         AND se.undone_at IS NULL
         AND se.scanned_at > NOW() - INTERVAL '1 hour'
       GROUP BY 1
       ORDER BY 1`,
      [params.id],
    );

    const lastScan = await db().query<{ scanned_at: string | null }>(
      `SELECT MAX(scanned_at)::text AS scanned_at
       FROM tickets.scan_events
       WHERE event_id = $1 AND undone_at IS NULL`,
      [params.id],
    );

    const capacity = ev.rows[0].capacity;
    return NextResponse.json({
      eventTitle: ev.rows[0].title,
      reentryAllowed: ev.rows[0].reentry_allowed,
      /** Právě uvnitř. */
      inside,
      /** Kolik vstupenek se aspoň jednou odbavilo. */
      admittedEver,
      /** Kolik se jich prodalo. */
      sold,
      /** Kolik lidí je venku, ale může se vrátit. */
      outsideWithReentry: Math.max(0, admittedEver - inside),
      capacity,
      occupancyPct:
        capacity && capacity > 0 ? Math.round((inside / capacity) * 100) : null,
      gates: gates.rows.map((g) => ({
        gate: g.gate_label,
        entries: Number(g.entries),
        exits: Number(g.exits),
      })),
      lastScanAt: lastScan.rows[0]?.scanned_at ?? null,
    });
  });
}
