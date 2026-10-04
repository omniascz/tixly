/**
 * GET /api/admin/events/[id]/break-even
 *
 * Kolik vstupenek ještě chybí do pokrytí nákladů — a jaký bude výsledek,
 * ne jen tržba. Počítá se přes skutečný mix cenových hladin, sazbu DPH podle
 * země a kategorie akce a naši provizi z ceníku pořadatele.
 *
 * Honoráře umělců ze smluv se započítávají (`lib/budget/outlook.ts`) —
 * bez nich by akce s procentním honorářem vypadala jako zisková.
 *
 * Odpověď je záměrně kompletní (náklady, příspěvek, scénáře), aby přehled akce
 * nemusel skládat tři dotazy dohromady.
 */

import { NextRequest, NextResponse } from 'next/server';
import { runAsPromoter } from '@/lib/admin-auth';
import { type TicketTypeSales } from '@/lib/budget/break-even';
import { computeOutlook } from '@/lib/budget/outlook';
import { db } from '@/lib/db/rls-pool';
import { AGREEMENT_TERMS_COLUMNS, toDealTerms, type AgreementTermsRow } from '@/lib/royalties/deal';
import { eventTicketVatPct, VAT_RATE_MISSING_MESSAGE } from '@/lib/tax/vat-rates';

/** Výchozí provize platformy, když pořadatel nemá vlastní ceník. */
const DEFAULT_PLATFORM_FEE_BPS = 500;

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  return runAsPromoter(req, async (ctx) => {
    if (!/^[0-9a-f-]{36}$/i.test(params.id)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const evRes = await db().query<{
      vat_category: string | null;
      country: string | null;
      vat_payer: boolean;
      primary_currency: string;
    }>(
      `SELECT e.vat_category, p.country, p.vat_payer, p.primary_currency
       FROM catalog.events e
       JOIN platform.promoters p ON p.id = e.promoter_id
       WHERE e.id = $1 AND e.promoter_id = $2`,
      [params.id, ctx.promoterId],
    );
    const ev = evRes.rows[0];
    if (!ev) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    // Kolo 7 (C-54): sazba z DB podle typů vstupenek (ne natvrdo podle kategorie akce).
    const vatPct = await eventTicketVatPct(db(), params.id);
    if (vatPct === null) {
      return NextResponse.json({ error: 'VAT_RATE_MISSING', message: VAT_RATE_MISSING_MESSAGE }, { status: 422 });
    }
    const ticketVatRatePct = vatPct;

    const feeRes = await db().query<{ percentage_fee: number }>(
      `SELECT percentage_fee FROM platform.fee_schedules
       WHERE promoter_id = $1 AND currency = $2 AND is_active = TRUE
         AND (valid_from IS NULL OR valid_from <= NOW())
         AND (valid_until IS NULL OR valid_until > NOW())
       ORDER BY created_at DESC LIMIT 1`,
      [ctx.promoterId, ev.primary_currency],
    );
    const platformFeeBps = feeRes.rows[0]?.percentage_fee ?? DEFAULT_PLATFORM_FEE_BPS;

    const costsRes = await db().query<{
      amount_minor: number;
      vat_rate_pct: number;
      is_per_attendee: boolean;
      royalty_agreement_id: string | null;
    }>(
      `SELECT amount_minor, vat_rate_pct, is_per_attendee, royalty_agreement_id
       FROM catalog.event_costs WHERE event_id = $1`,
      [params.id],
    );

    const dealsRes = await db().query<AgreementTermsRow & { id: string }>(
      `SELECT id, ${AGREEMENT_TERMS_COLUMNS}
       FROM lineups.royalty_agreements
       WHERE event_id = $1 AND promoter_id = $2 AND status = 'active'`,
      [params.id, ctx.promoterId],
    );

    // Prodané kusy per typ vstupenky. Dynamická cena má přednost před základní,
    // protože kupující platí tu, která je právě nastavená.
    const ttRes = await db().query<{
      price_minor: number;
      total_qty: number;
      sold_qty: string;
    }>(
      `SELECT COALESCE(tt.dynamic_price_minor, tt.base_price)::int AS price_minor,
              tt.total_qty,
              COALESCE((
                SELECT SUM(oi.quantity)
                FROM orders.order_items oi
                JOIN orders.orders o ON o.id = oi.order_id
                WHERE oi.ticket_type_id = tt.id AND o.status = 'paid'
              ), 0)::text AS sold_qty
       FROM catalog.ticket_types tt
       WHERE tt.event_id = $1 AND tt.is_donation = FALSE`,
      [params.id],
    );

    const ticketTypes: TicketTypeSales[] = ttRes.rows.map((t) => ({
      priceMinor: t.price_minor,
      totalQty: t.total_qty,
      soldQty: Number(t.sold_qty),
    }));

    const input = {
      costs: costsRes.rows.map((c) => ({
        amountMinor: c.amount_minor,
        vatRatePct: c.vat_rate_pct,
        isPerAttendee: c.is_per_attendee,
        agreementId: c.royalty_agreement_id,
      })),
      deals: dealsRes.rows.map((a) => ({ agreementId: a.id, terms: toDealTerms(a) })),
      ticketTypes,
      ticketVatRatePct,
      platformFeeBps,
      vatPayer: ev.vat_payer,
    };

    const capacity = ticketTypes.reduce((a, t) => a + Math.max(0, t.totalQty), 0);
    const { breakEven: result, scenarios } = computeOutlook(input, [
      { label: 'pesimistický (40 %)', ticketsSold: Math.round(capacity * 0.4) },
      { label: 'střední (65 %)', ticketsSold: Math.round(capacity * 0.65) },
      { label: 'vyprodáno', ticketsSold: capacity },
    ]);

    return NextResponse.json({
      currency: ev.primary_currency,
      ticketVatRatePct,
      platformFeeBps,
      vatPayer: ev.vat_payer,
      breakEven: result,
      scenarios,
    });
  });
}
