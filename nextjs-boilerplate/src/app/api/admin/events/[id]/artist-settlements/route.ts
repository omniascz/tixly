/**
 * GET  /api/admin/events/[id]/artist-settlements — vyúčtování s umělci pro akci
 * POST /api/admin/events/[id]/artist-settlements — sestaví rozpracované vyúčtování
 *
 * Sestavení spočítá honorář ze **současných** dat (prodej, náklady, podmínky).
 * Dokud je vyúčtování rozpracované, přepočítává se; uzavřením se čísla zmrazí
 * (viz .../[settlementId]/close).
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { runAsActivePromoter, runAsPromoter } from '@/lib/admin-auth';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';
import {
  computeArtistSettlement,
  toDealTerms,
  type AgreementTermsRow,
} from '@/lib/royalties/deal';
import { resolveVatRate } from '@/lib/tax/vat-rates';
import { ALREADY_PAID_LINE_KEY, COMMITTED_PAYOUT_STATUSES_SQL } from '@/lib/royalties/settlement-doc';

export const dynamic = 'force-dynamic';

const postSchema = z.object({
  agreementId: z.string().uuid(),
});

interface AgreementRow extends AgreementTermsRow {
  id: string;
  artist_name: string;
  artist_email: string | null;
  currency: string;
  included_ticket_type_ids: string[] | null;
}

/** Data akce potřebná pro výpočet honoráře. */
async function loadEventFinancials(
  eventId: string,
  agreementId: string,
  includedTicketTypeIds: string[] | null,
): Promise<{
  eventTitle: string;
  eventDate: string;
  capacity: number;
  ticketsSold: number;
  grossRevenueMinor: number;
  ticketVatRatePct: number;
  fixedCostsMinor: number;
  perAttendeeCostMinor: number;
}> {
  const ev = await runWithServiceContext(() =>
    db().query<{
      title: string;
      date_start: string;
      vat_category: string | null;
      country: string | null;
    }>(
      `SELECT e.title, e.date_start::text AS date_start, e.vat_category, p.country
       FROM catalog.events e
       JOIN platform.promoters p ON p.id = e.promoter_id
       WHERE e.id = $1`,
      [eventId],
    ),
  );
  const row = ev.rows[0];

  const filterClause =
    includedTicketTypeIds && includedTicketTypeIds.length > 0
      ? `AND oi.ticket_type_id = ANY($2::uuid[])`
      : '';
  const args: unknown[] = [eventId];
  if (includedTicketTypeIds && includedTicketTypeIds.length > 0) args.push(includedTicketTypeIds);

  const sales = await runWithServiceContext(() =>
    db().query<{ sold: string; revenue: string }>(
      `SELECT COALESCE(SUM(oi.quantity), 0)::text    AS sold,
              COALESCE(SUM(oi.total_price), 0)::text AS revenue
       FROM orders.order_items oi
       JOIN orders.orders o ON o.id = oi.order_id
       WHERE o.event_id = $1 AND o.status = 'paid' ${filterClause}`,
      args,
    ),
  );

  const cap = await runWithServiceContext(() =>
    db().query<{ capacity: string }>(
      `SELECT COALESCE(SUM(total_qty), 0)::text AS capacity
       FROM catalog.ticket_types WHERE event_id = $1 AND is_donation = FALSE`,
      [eventId],
    ),
  );

  const costs = await runWithServiceContext(() =>
    db().query<{ fixed: string; per_head: string }>(
      `SELECT COALESCE(SUM(amount_minor) FILTER (WHERE NOT is_per_attendee), 0)::text AS fixed,
              COALESCE(SUM(amount_minor) FILTER (WHERE is_per_attendee), 0)::text     AS per_head
       FROM catalog.event_costs
       -- Položka „Honorář — …" vzniklá přijetím nabídky je garance TÉHOŽ
       -- umělce. Podíl nad bodem zlomu garanci odečítá sám; kdyby zůstala
       -- i v nákladech, odečetla by se dvakrát a umělec by dostal méně.
       WHERE event_id = $1 AND royalty_agreement_id IS DISTINCT FROM $2`,
      [eventId, agreementId],
    ),
  );

  return {
    eventTitle: row?.title ?? '',
    eventDate: row?.date_start ?? '',
    capacity: Number(cap.rows[0]?.capacity ?? 0),
    ticketsSold: Number(sales.rows[0]?.sold ?? 0),
    grossRevenueMinor: Number(sales.rows[0]?.revenue ?? 0),
    ticketVatRatePct: resolveVatRate({
      country: row?.country,
      vatCategory: row?.vat_category ?? 'cultural',
    }),
    fixedCostsMinor: Number(costs.rows[0]?.fixed ?? 0),
    perAttendeeCostMinor: Number(costs.rows[0]?.per_head ?? 0),
  };
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  return runAsPromoter(req, async (ctx) => {
    const r = await runWithServiceContext(() =>
      db().query(
        `SELECT s.id, s.agreement_id, s.artist_name, s.currency, s.status,
                s.capacity, s.tickets_sold, s.gross_revenue_minor, s.net_revenue_minor,
                s.fee_minor, s.share_minor, s.deposit_minor, s.withholding_minor,
                s.payable_minor, s.lines, s.closed_at, s.signed_at, s.signer_name,
                s.document_hash, s.payout_id, s.supersedes_id
         FROM lineups.artist_settlements s
         WHERE s.event_id = $1 AND s.promoter_id = $2
         ORDER BY s.created_at DESC`,
        [params.id, ctx.promoterId],
      ),
    );
    return NextResponse.json({ settlements: r.rows });
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  return runAsActivePromoter(req, async (promoter) => {
    const raw: unknown = await req.json().catch(() => ({}));
    const parsed = postSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json({ error: 'BAD_INPUT', issues: parsed.error.issues }, { status: 422 });
    }

    const agrRes = await runWithServiceContext(() =>
      db().query<AgreementRow>(
        `SELECT id, artist_name, artist_email, currency, royalty_type, percent_rate,
                flat_amount_halire, per_ticket_halire, min_guarantee_halire, cap_halire,
                deposit_minor, backend_pct, bonus_tiers, split_pct, percent_base,
                withholding_tax_pct, included_ticket_type_ids
         FROM lineups.royalty_agreements
         WHERE id = $1 AND event_id = $2 AND promoter_id = $3`,
        [parsed.data.agreementId, params.id, promoter.promoterId],
      ),
    );
    const a = agrRes.rows[0];
    if (!a) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const fin = await loadEventFinancials(params.id, a.id, a.included_ticket_type_ids);
    const netRevenueMinor = Math.round(
      fin.grossRevenueMinor / (1 + fin.ticketVatRatePct / 100),
    );

    const result = computeArtistSettlement(toDealTerms(a), {
      grossTicketRevenueMinor: fin.grossRevenueMinor,
      ticketVatRatePct: fin.ticketVatRatePct,
      ticketsSold: fin.ticketsSold,
      ticketsAvailable: fin.capacity,
      fixedCostsMinor: fin.fixedCostsMinor,
      perAttendeeCostMinor: fin.perAttendeeCostMinor,
    });

    // Průběžné výplaty z podílu (/artist-payouts/calculate), které už jsou
    // schválené nebo odeslané, jsou zálohou na tentýž honorář. Bez odečtu by
    // umělec dostal honorář jednou průběžně a podruhé z vyúčtování.
    // Nevyřízené (`pending`) se neodečítají — uzavření je zruší a nahradí.
    const paidRes = await runWithServiceContext(() =>
      db().query<{ paid: number }>(
        `SELECT COALESCE(SUM(net_payout_halire), 0)::int AS paid
         FROM lineups.artist_payouts
         WHERE agreement_id = $1 AND status IN ${COMMITTED_PAYOUT_STATUSES_SQL}`,
        [a.id],
      ),
    );
    const alreadyPaidMinor = paidRes.rows[0]?.paid ?? 0;
    if (alreadyPaidMinor > 0) {
      result.lines.push({
        key: ALREADY_PAID_LINE_KEY,
        label: 'Již vyplaceno z průběžného podílu',
        amountMinor: -alreadyPaidMinor,
      });
      result.payableMinor -= alreadyPaidMinor;
    }

    // Jedno rozpracované vyúčtování na smlouvu — další sestavení ho přepíše,
    // aby se v seznamu nehromadily koncepty s různými čísly.
    const ins = await runWithServiceContext(() =>
      db().query<{ id: string }>(
        `INSERT INTO lineups.artist_settlements
           (event_id, promoter_id, agreement_id, artist_name, artist_email, currency,
            status, capacity, tickets_sold, gross_revenue_minor, ticket_vat_rate_pct,
            net_revenue_minor, fixed_costs_minor, per_attendee_cost_minor,
            fee_minor, share_minor, deposit_minor, withholding_minor, payable_minor, lines)
         VALUES ($1,$2,$3,$4,$5,$6,'draft',$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19::jsonb)
         ON CONFLICT (agreement_id) WHERE status = 'draft'
         DO UPDATE SET
           capacity = EXCLUDED.capacity,
           tickets_sold = EXCLUDED.tickets_sold,
           gross_revenue_minor = EXCLUDED.gross_revenue_minor,
           ticket_vat_rate_pct = EXCLUDED.ticket_vat_rate_pct,
           net_revenue_minor = EXCLUDED.net_revenue_minor,
           fixed_costs_minor = EXCLUDED.fixed_costs_minor,
           per_attendee_cost_minor = EXCLUDED.per_attendee_cost_minor,
           fee_minor = EXCLUDED.fee_minor,
           share_minor = EXCLUDED.share_minor,
           deposit_minor = EXCLUDED.deposit_minor,
           withholding_minor = EXCLUDED.withholding_minor,
           payable_minor = EXCLUDED.payable_minor,
           lines = EXCLUDED.lines,
           updated_at = NOW()
         RETURNING id`,
        [
          params.id,
          promoter.promoterId,
          a.id,
          a.artist_name,
          a.artist_email,
          a.currency,
          fin.capacity,
          fin.ticketsSold,
          fin.grossRevenueMinor,
          fin.ticketVatRatePct,
          netRevenueMinor,
          fin.fixedCostsMinor,
          fin.perAttendeeCostMinor,
          result.feeMinor,
          result.shareMinor,
          result.depositMinor,
          result.withholdingTaxMinor,
          result.payableMinor,
          JSON.stringify(result.lines),
        ],
      ),
    );

    return NextResponse.json(
      {
        ok: true,
        id: ins.rows[0].id,
        status: 'draft',
        payableMinor: result.payableMinor,
        lines: result.lines,
      },
      { status: 201 },
    );
  });
}
