/**
 * GET /api/admin/events/[id]/artist-settlements/[settlementId]
 *
 * Detail vyúčtování včetně vykresleného dokumentu, který jde poslat agentovi
 * nebo vytisknout. U uzavřeného vyúčtování se navíc ověřuje otisk — kdyby
 * někdo sáhl do dat v databázi, pozná se to.
 */

import { NextRequest, NextResponse } from 'next/server';
import { runAsPromoter } from '@/lib/admin-auth';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';
import type { FeeLine } from '@/lib/royalties/deal';
import {
  hashSettlement,
  renderSettlementText,
  type SettlementSnapshot,
} from '@/lib/royalties/settlement-doc';

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string; settlementId: string } },
): Promise<Response> {
  return runAsPromoter(req, async (ctx) => {
    const r = await runWithServiceContext(() =>
      db().query<{
        id: string;
        status: string;
        artist_name: string;
        artist_email: string | null;
        currency: string;
        capacity: number;
        tickets_sold: number;
        gross_revenue_minor: number;
        ticket_vat_rate_pct: number;
        net_revenue_minor: number;
        fixed_costs_minor: number;
        per_attendee_cost_minor: number;
        fee_minor: number;
        share_minor: number;
        deposit_minor: number;
        withholding_minor: number;
        payable_minor: number;
        lines: FeeLine[];
        document_hash: string | null;
        closed_at: string | null;
        signed_at: string | null;
        signer_name: string | null;
        payout_id: string | null;
        event_title: string;
        event_date: string;
      }>(
        `SELECT s.*, e.title AS event_title, e.date_start::text AS event_date
         FROM lineups.artist_settlements s
         JOIN catalog.events e ON e.id = s.event_id
         WHERE s.id = $1 AND s.event_id = $2 AND s.promoter_id = $3`,
        [params.settlementId, params.id, ctx.promoterId],
      ),
    );
    const s = r.rows[0];
    if (!s) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const snapshot: SettlementSnapshot = {
      eventTitle: s.event_title,
      eventDate: s.event_date,
      artistName: s.artist_name,
      currency: s.currency,
      capacity: s.capacity,
      ticketsSold: s.tickets_sold,
      grossRevenueMinor: s.gross_revenue_minor,
      ticketVatRatePct: s.ticket_vat_rate_pct,
      netRevenueMinor: s.net_revenue_minor,
      fixedCostsMinor: s.fixed_costs_minor,
      perAttendeeCostMinor: s.per_attendee_cost_minor,
      feeMinor: s.fee_minor,
      shareMinor: s.share_minor,
      depositMinor: s.deposit_minor,
      withholdingMinor: s.withholding_minor,
      payableMinor: s.payable_minor,
      lines: s.lines,
    };

    const currentHash = hashSettlement(snapshot);
    const tampered = s.document_hash !== null && s.document_hash !== currentHash;

    return NextResponse.json({
      settlement: {
        id: s.id,
        status: s.status,
        artistName: s.artist_name,
        artistEmail: s.artist_email,
        currency: s.currency,
        capacity: s.capacity,
        ticketsSold: s.tickets_sold,
        grossRevenueMinor: s.gross_revenue_minor,
        netRevenueMinor: s.net_revenue_minor,
        feeMinor: s.fee_minor,
        depositMinor: s.deposit_minor,
        withholdingMinor: s.withholding_minor,
        payableMinor: s.payable_minor,
        lines: s.lines,
        closedAt: s.closed_at,
        signedAt: s.signed_at,
        signerName: s.signer_name,
        payoutId: s.payout_id,
        documentHash: s.document_hash,
      },
      document: renderSettlementText(snapshot),
      /** TRUE = uložená čísla nesouhlasí s otiskem pořízeným při uzavření. */
      tampered,
    });
  });
}
