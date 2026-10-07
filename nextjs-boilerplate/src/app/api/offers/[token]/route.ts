/**
 * GET /api/offers/[token] — nabídka očima agenta
 *
 * Veřejné, bez přihlášení: oprávnění nese token v odkazu. Vrací jen to, co
 * agent potřebuje k rozhodnutí — nic o jiných akcích, nic o dalších nabídkách.
 *
 * Špatný a propadlý token se navenek chovají stejně jako neexistující nabídka,
 * aby se z odpovědí nedalo zjišťovat, které odkazy existují.
 */

import { NextRequest, NextResponse } from 'next/server';
import { checkOfferAccess, canRespond, hashOfferToken } from '@/lib/booking/offer-token';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';
import type { BonusTier } from '@/lib/royalties/deal';

export const dynamic = 'force-dynamic';

export interface OfferRow {
  id: string;
  status: string;
  artist_name: string;
  agent_name: string | null;
  performance_date: string | null;
  venue_name: string | null;
  set_length_minutes: number | null;
  currency: string;
  royalty_type: string;
  percent_rate: string | null;
  flat_amount_halire: number | null;
  per_ticket_halire: number | null;
  min_guarantee_halire: number | null;
  cap_halire: number | null;
  deposit_minor: number;
  backend_pct: string | null;
  bonus_tiers: BonusTier[] | null;
  percent_base: string;
  withholding_tax_pct: string;
  terms_note: string | null;
  valid_until: string | null;
  token_expires_at: string | null;
  signed_at: string | null;
  signer_name: string | null;
  counter_note: string | null;
  promoter_name: string | null;
  event_title: string | null;
}

/** Načte nabídku podle otisku tokenu. Servisní kontext — agent nemá tenanta. */
async function loadOfferByToken(token: string): Promise<OfferRow | null> {
  if (!/^[A-Za-z0-9_-]{20,120}$/.test(token)) return null;
  const hash = hashOfferToken(token);
  const r = await runWithServiceContext(() =>
    db().query<OfferRow>(
      `SELECT o.id, o.status, o.artist_name, o.agent_name,
              o.performance_date::text AS performance_date, o.venue_name,
              o.set_length_minutes, o.currency, o.royalty_type, o.percent_rate,
              o.flat_amount_halire, o.per_ticket_halire, o.min_guarantee_halire,
              o.cap_halire, o.deposit_minor, o.backend_pct, o.bonus_tiers,
              o.percent_base, o.withholding_tax_pct, o.terms_note,
              o.valid_until, o.token_expires_at, o.signed_at, o.signer_name,
              o.counter_note,
              p.name AS promoter_name, e.title AS event_title
       FROM lineups.artist_offers o
       JOIN platform.promoters p ON p.id = o.promoter_id
       LEFT JOIN catalog.events e ON e.id = o.event_id
       WHERE o.access_token_hash = $1`,
      [hash],
    ),
  );
  return r.rows[0] ?? null;
}

export async function GET(_req: NextRequest, props: { params: Promise<{ token: string }> }): Promise<Response> {
  const params = await props.params;
  const offer = await loadOfferByToken(params.token);
  const now = new Date();

  const access = checkOfferAccess({
    matches: offer !== null,
    tokenExpiresAt: offer?.token_expires_at ? new Date(offer.token_expires_at) : null,
    status: offer?.status ?? 'draft',
    now,
  });

  if (!access.ok || !offer) {
    const message =
      access.ok === false && access.reason === 'expired'
        ? 'Platnost odkazu vypršela. Požádej pořadatele o nový.'
        : 'Nabídka nebyla nalezena.';
    return NextResponse.json({ error: 'NOT_AVAILABLE', message }, { status: 404 });
  }

  return NextResponse.json({
    offer: {
      artistName: offer.artist_name,
      agentName: offer.agent_name,
      promoterName: offer.promoter_name,
      eventTitle: offer.event_title,
      performanceDate: offer.performance_date,
      venueName: offer.venue_name,
      setLengthMinutes: offer.set_length_minutes,
      currency: offer.currency,
      terms: {
        royaltyType: offer.royalty_type,
        percentRate: offer.percent_rate === null ? null : Number(offer.percent_rate),
        percentBase: offer.percent_base,
        flatMinor: offer.flat_amount_halire,
        perTicketMinor: offer.per_ticket_halire,
        minGuaranteeMinor: offer.min_guarantee_halire,
        capMinor: offer.cap_halire,
        depositMinor: offer.deposit_minor,
        backendPct: offer.backend_pct === null ? null : Number(offer.backend_pct),
        bonusTiers: offer.bonus_tiers ?? [],
        withholdingTaxPct: Number(offer.withholding_tax_pct),
      },
      note: offer.terms_note,
      validUntil: offer.valid_until,
      status: offer.status,
      counterNote: offer.counter_note,
      signedAt: offer.signed_at,
      signerName: offer.signer_name,
    },
    canRespond: canRespond(
      offer.status,
      offer.valid_until ? new Date(offer.valid_until) : null,
      now,
    ),
  });
}
