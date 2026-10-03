/**
 * GET  /api/admin/events/[id]/offers — nabídky umělcům pro akci
 * POST /api/admin/events/[id]/offers — sestaví nabídku (koncept)
 *
 * Nabídka se sestavuje nad stejnými podmínkami, jaké pak platí ve smlouvě —
 * schválením se překlopí beze změny čísel. Dokud je koncept, agent ji nevidí.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { runAsActivePromoter, runAsPromoter } from '@/lib/admin-auth';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';

export const dynamic = 'force-dynamic';

const bonusTierSchema = z
  .object({
    atTickets: z.number().int().min(1).optional(),
    atSelloutPct: z.number().min(1).max(100).optional(),
    amountMinor: z.number().int().min(0),
  })
  .refine((t) => t.atTickets !== undefined || t.atSelloutPct !== undefined, {
    message: 'Bonus musí mít podmínku: počet vstupenek nebo procento vyprodanosti.',
  });

const postSchema = z.object({
  artistName: z.string().min(1).max(200),
  artistEmail: z.string().email().max(200).optional(),
  agentName: z.string().max(200).optional(),
  agentEmail: z.string().email().max(200).optional(),
  setLengthMinutes: z.number().int().min(1).max(600).optional(),
  currency: z.string().regex(/^[A-Z]{3}$/).optional(),
  royaltyType: z.enum(['percent', 'flat', 'per_ticket', 'percent_plus_flat']).optional(),
  percentRate: z.number().min(0).max(100).optional(),
  flatMinor: z.number().int().min(0).optional(),
  perTicketMinor: z.number().int().min(0).optional(),
  minGuaranteeMinor: z.number().int().min(0).optional(),
  capMinor: z.number().int().min(0).optional(),
  depositMinor: z.number().int().min(0).optional(),
  backendPct: z.number().min(0).max(100).optional(),
  bonusTiers: z.array(bonusTierSchema).max(10).optional(),
  splitPct: z.number().min(0.01).max(100).optional(),
  percentBase: z.enum(['gross', 'net_of_vat']).optional(),
  withholdingTaxPct: z.number().min(0).max(100).optional(),
  taxResidency: z.string().regex(/^[A-Z]{2}$/).optional(),
  termsNote: z.string().max(4000).optional(),
  validUntil: z.string().datetime().optional(),
});

async function assertOwner(eventId: string, promoterId: string): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/i.test(eventId)) return false;
  const r = await runWithServiceContext(() =>
    db().query(`SELECT 1 FROM catalog.events WHERE id=$1 AND promoter_id=$2 LIMIT 1`, [
      eventId,
      promoterId,
    ]),
  );
  return r.rows.length > 0;
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  return runAsPromoter(req, async (ctx) => {
    if (!(await assertOwner(params.id, ctx.promoterId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const r = await runWithServiceContext(() =>
      db().query(
        `SELECT id, version, supersedes_id, artist_name, artist_email, agent_name, agent_email,
                performance_date::text AS performance_date, venue_name, set_length_minutes,
                currency, royalty_type, percent_rate, flat_amount_halire, per_ticket_halire,
                min_guarantee_halire, cap_halire, deposit_minor, backend_pct, bonus_tiers,
                split_pct, percent_base, withholding_tax_pct, tax_residency,
                terms_note, status, valid_until, sent_at, responded_at, counter_note,
                signed_at, signer_name, agreement_id, cost_id, token_expires_at
         FROM lineups.artist_offers
         WHERE event_id = $1 AND promoter_id = $2
         ORDER BY created_at DESC`,
        [params.id, ctx.promoterId],
      ),
    );
    return NextResponse.json({ offers: r.rows });
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  return runAsActivePromoter(req, async (promoter) => {
    if (!(await assertOwner(params.id, promoter.promoterId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const raw: unknown = await req.json().catch(() => ({}));
    const parsed = postSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json({ error: 'BAD_INPUT', issues: parsed.error.issues }, { status: 422 });
    }
    const b = parsed.data;

    if (
      b.capMinor !== undefined &&
      b.minGuaranteeMinor !== undefined &&
      b.capMinor < b.minGuaranteeMinor
    ) {
      return NextResponse.json(
        {
          error: 'CAP_BELOW_GUARANTEE',
          message: 'Strop honoráře je nižší než garance — zkontroluj čísla, než to pošleš agentovi.',
        },
        { status: 422 },
      );
    }

    // Datum a sál z akce, ať je nabídka úplná bez dalšího vyplňování.
    const ev = await runWithServiceContext(() =>
      db().query<{ date_start: string; venue_name: string | null; primary_currency: string }>(
        `SELECT e.date_start::text AS date_start, v.name AS venue_name, p.primary_currency
         FROM catalog.events e
         LEFT JOIN catalog.venues v ON v.id = e.venue_id
         JOIN platform.promoters p ON p.id = e.promoter_id
         WHERE e.id = $1`,
        [params.id],
      ),
    );
    const evRow = ev.rows[0];

    const ins = await runWithServiceContext(() =>
      db().query<{ id: string }>(
        `INSERT INTO lineups.artist_offers
           (promoter_id, event_id, artist_name, artist_email, agent_name, agent_email,
            performance_date, venue_name, set_length_minutes, currency,
            royalty_type, percent_rate, flat_amount_halire, per_ticket_halire,
            min_guarantee_halire, cap_halire, deposit_minor, backend_pct, bonus_tiers,
            split_pct, percent_base, withholding_tax_pct, tax_residency,
            terms_note, valid_until, created_by_user_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7::date,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,
                 $19::jsonb,$20,$21,$22,$23,$24,$25,$26)
         RETURNING id`,
        [
          promoter.promoterId,
          params.id,
          b.artistName,
          b.artistEmail ?? null,
          b.agentName ?? null,
          b.agentEmail ?? null,
          evRow?.date_start?.slice(0, 10) ?? null,
          evRow?.venue_name ?? null,
          b.setLengthMinutes ?? null,
          b.currency ?? evRow?.primary_currency ?? 'CZK',
          b.royaltyType ?? 'percent',
          b.percentRate ?? null,
          b.flatMinor ?? null,
          b.perTicketMinor ?? null,
          b.minGuaranteeMinor ?? null,
          b.capMinor ?? null,
          b.depositMinor ?? 0,
          b.backendPct ?? null,
          JSON.stringify(b.bonusTiers ?? []),
          b.splitPct ?? 100,
          b.percentBase ?? 'gross',
          b.withholdingTaxPct ?? 0,
          b.taxResidency ?? null,
          b.termsNote ?? null,
          b.validUntil ?? null,
          promoter.userId,
        ],
      ),
    );

    return NextResponse.json({ ok: true, id: ins.rows[0].id, status: 'draft' }, { status: 201 });
  });
}
