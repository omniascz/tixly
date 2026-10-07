/**
 * GET /api/events/[id]/bundles — public list aktivních bundles s details.
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';


interface BundleRow {
  id: string;
  name: string;
  description: string | null;
  ticket_type_name: string;
  ticket_price: number;
  discount_pct: number;
  bundle_addons_total: number;
  addon_summary: string;
}

export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }): Promise<Response> {
  const params = await props.params;
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) {
    return NextResponse.json({ bundles: [] });
  }
  const r = await db().query<BundleRow>(
    `SELECT b.id, b.name, b.description, b.discount_pct,
            tt.name AS ticket_type_name, tt.base_price AS ticket_price,
            COALESCE((
              SELECT SUM(ca.price_halire * ba.quantity)::int
              FROM catalog.event_bundle_addons ba
              JOIN public.checkout_addons ca ON ca.id = ba.addon_id
              WHERE ba.bundle_id = b.id
            ), 0) AS bundle_addons_total,
            COALESCE((
              SELECT string_agg(ca.name || (CASE WHEN ba.quantity > 1 THEN ' ×' || ba.quantity ELSE '' END), ', ')
              FROM catalog.event_bundle_addons ba
              JOIN public.checkout_addons ca ON ca.id = ba.addon_id
              WHERE ba.bundle_id = b.id
            ), '') AS addon_summary
     FROM catalog.event_bundles b
     JOIN catalog.ticket_types tt ON tt.id = b.ticket_type_id
     WHERE b.event_id = $1 AND b.active = TRUE
     ORDER BY b.display_order, b.created_at`,
    [params.id],
  );

  return NextResponse.json({
    bundles: r.rows.map((b) => {
      const gross = b.ticket_price + b.bundle_addons_total;
      const final = Math.floor(gross * (1 - b.discount_pct / 100));
      return {
        id: b.id,
        name: b.name,
        description: b.description,
        ticketTypeName: b.ticket_type_name,
        addonSummary: b.addon_summary,
        discountPct: b.discount_pct,
        grossPriceHalire: gross,
        finalPriceHalire: final,
        savingsHalire: gross - final,
      };
    }),
  });
}
