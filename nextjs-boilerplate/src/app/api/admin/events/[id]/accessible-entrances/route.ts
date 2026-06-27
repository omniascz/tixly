/**
 * GET  /api/admin/events/[id]/accessible-entrances
 *   → { zones: [{ id, name, zone_type, accessible_gate_id, accessible_gate_label, accessible_gate_notes }] }
 *
 * PATCH /api/admin/events/[id]/accessible-entrances
 *   Body: { zoneId, accessibleGateId: uuid | null, accessibleGateNotes: string | null }
 *   → { ok: true }
 *
 * Umožňuje promotérovi přiřadit bezbariérový vstup (venue_gate) ke každé zóně akce.
 * Zobrazí se na vstupence a v admin dashboardu.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db/rls-pool';
import { runAsActivePromoter } from '@/lib/admin-auth';

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  return runAsActivePromoter(req, async (promoter) => {
    const evCheck = await db().query(
      `SELECT id FROM catalog.events WHERE id = $1 AND promoter_id = $2`,
      [params.id, promoter.promoterId],
    );
    if (!evCheck.rows[0]) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const rows = await db().query<{
      id: string; name: string; zone_type: string | null;
      accessible_gate_id: string | null;
      accessible_gate_label: string | null;
      accessible_gate_code: string | null;
      accessible_gate_notes: string | null;
      gate_is_accessible: boolean | null;
    }>(
      `SELECT ez.id, ez.name, ez.zone_type,
              ez.accessible_gate_id,
              vg.label  AS accessible_gate_label,
              vg.code   AS accessible_gate_code,
              ez.accessible_gate_notes,
              vg.is_accessible AS gate_is_accessible
         FROM catalog.event_zones ez
         LEFT JOIN catalog.venue_gates vg ON vg.id = ez.accessible_gate_id
        WHERE ez.event_id = $1
        ORDER BY ez.display_order, ez.name`,
      [params.id],
    );

    return NextResponse.json({ zones: rows.rows });
  });
}

const patchSchema = z.object({
  zoneId:               z.string().uuid(),
  accessibleGateId:     z.string().uuid().nullable(),
  accessibleGateNotes:  z.string().max(500).nullable().optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  return runAsActivePromoter(req, async (promoter) => {
    const evCheck = await db().query(
      `SELECT id FROM catalog.events WHERE id = $1 AND promoter_id = $2`,
      [params.id, promoter.promoterId],
    );
    if (!evCheck.rows[0]) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const body: unknown = await req.json().catch(() => ({}));
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 422 });
    const d = parsed.data;

    await db().query(
      `UPDATE catalog.event_zones
          SET accessible_gate_id    = $1,
              accessible_gate_notes = $2
        WHERE id = $3 AND event_id = $4`,
      [d.accessibleGateId, d.accessibleGateNotes ?? null, d.zoneId, params.id],
    );

    return NextResponse.json({ ok: true });
  });
}
