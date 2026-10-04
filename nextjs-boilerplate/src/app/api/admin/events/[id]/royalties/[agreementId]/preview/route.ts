/**
 * GET /api/admin/events/[id]/royalties/[agreementId]/preview
 *
 * „Co umělec dostane při 30, 50, 70 a 100 procentech obsazenosti."
 * Vyjednávací nástroj a zároveň kontrola, že podmínky nejsou nesmyslné —
 * když honorář při vyprodání spolkne celou tržbu, je to vidět hned,
 * ne až po akci.
 */

import { NextRequest, NextResponse } from 'next/server';
import { runAsPromoter } from '@/lib/admin-auth';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';
import { previewByOccupancy, toDealTerms, type AgreementTermsRow } from '@/lib/royalties/deal';
import { eventTicketVatPct, VAT_RATE_MISSING_MESSAGE } from '@/lib/tax/vat-rates';

export const dynamic = 'force-dynamic';

interface AgreementRow extends AgreementTermsRow {
  currency: string;
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string; agreementId: string } },
): Promise<Response> {
  return runAsPromoter(req, async (ctx) => {
    const agrRes = await runWithServiceContext(() =>
      db().query<AgreementRow>(
        `SELECT royalty_type, percent_rate, flat_amount_halire, per_ticket_halire,
                min_guarantee_halire, cap_halire, deposit_minor, backend_pct,
                bonus_tiers, split_pct, percent_base, withholding_tax_pct, currency
         FROM lineups.royalty_agreements
         WHERE id = $1 AND event_id = $2 AND promoter_id = $3`,
        [params.agreementId, params.id, ctx.promoterId],
      ),
    );
    const a = agrRes.rows[0];
    if (!a) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    // Kolo 7 (C-54): sazba z DB podle typů vstupenek.
    const vatPct = await runWithServiceContext(() => eventTicketVatPct(db(), params.id));
    if (vatPct === null) {
      return NextResponse.json({ error: 'VAT_RATE_MISSING', message: VAT_RATE_MISSING_MESSAGE }, { status: 422 });
    }
    const ticketVatRatePct = vatPct;

    // Kapacita a průměrná cena z typů vstupenek — vážená kapacitou, aby
    // náhled odpovídal tomu, co se reálně prodává.
    const ttRes = await runWithServiceContext(() =>
      db().query<{ price_minor: number; total_qty: number }>(
        `SELECT COALESCE(dynamic_price_minor, base_price)::int AS price_minor, total_qty
         FROM catalog.ticket_types
         WHERE event_id = $1 AND is_donation = FALSE`,
        [params.id],
      ),
    );
    const capacity = ttRes.rows.reduce((s, t) => s + t.total_qty, 0);
    const weighted = ttRes.rows.reduce((s, t) => s + t.price_minor * t.total_qty, 0);
    const averagePriceMinor = capacity > 0 ? Math.round(weighted / capacity) : 0;

    const costsRes = await runWithServiceContext(() =>
      db().query<{ fixed: string; per_head: string }>(
        `SELECT COALESCE(SUM(amount_minor) FILTER (WHERE NOT is_per_attendee), 0)::text AS fixed,
                COALESCE(SUM(amount_minor) FILTER (WHERE is_per_attendee), 0)::text     AS per_head
         FROM catalog.event_costs
         -- Garance tohoto umělce z přijaté nabídky se nepočítá jako náklad —
         -- podíl nad bodem zlomu ji odečítá sám (viz artist-settlements).
         WHERE event_id = $1 AND royalty_agreement_id IS DISTINCT FROM $2`,
        [params.id, params.agreementId],
      ),
    );

    const terms = toDealTerms(a);

    const rows = previewByOccupancy(
      terms,
      {
        ticketVatRatePct,
        ticketsAvailable: capacity,
        fixedCostsMinor: Number(costsRes.rows[0]?.fixed ?? 0),
        perAttendeeCostMinor: Number(costsRes.rows[0]?.per_head ?? 0),
      },
      averagePriceMinor,
    );

    return NextResponse.json({
      currency: a.currency,
      capacity,
      averagePriceMinor,
      ticketVatRatePct,
      rows,
    });
  });
}
