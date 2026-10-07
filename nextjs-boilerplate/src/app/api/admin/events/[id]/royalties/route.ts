/**
 * GET  /api/admin/events/[id]/royalties — smlouvy o honoráři pro akci
 * POST /api/admin/events/[id]/royalties — nová smlouva
 *
 * Kromě základních typů (procento, pevná částka, částka na vstupenku) umí
 * smlouva od migrace 474 i to, co se v praxi sjednává u větších jmen: zálohu,
 * podíl nad bodem zlomu, bonusy, dělení mezi více účinkujících a srážkovou daň.
 * Výpočet je v `lib/royalties/deal.ts`.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { runAsPromoter } from '@/lib/admin-auth';
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
  artist_id: z.string().uuid().optional(),
  artist_name: z.string().min(1).max(200),
  artist_email: z.string().email().max(200).optional(),
  bank_iban: z.string().max(50).optional(),
  bank_bic: z.string().max(20).optional(),
  royalty_type: z.enum(['percent', 'flat', 'per_ticket', 'percent_plus_flat']).optional(),
  percent_rate: z.number().min(0).max(100).optional(),
  flat_amount_halire: z.number().int().min(0).optional(),
  per_ticket_halire: z.number().int().min(0).optional(),
  min_guarantee_halire: z.number().int().min(0).optional(),
  cap_halire: z.number().int().min(0).optional(),
  included_ticket_type_ids: z.array(z.string().uuid()).optional(),
  notes: z.string().max(2000).optional(),
  // Podmínky z praxe
  currency: z.string().regex(/^[A-Z]{3}$/).optional(),
  deposit_minor: z.number().int().min(0).optional(),
  backend_pct: z.number().min(0).max(100).optional(),
  bonus_tiers: z.array(bonusTierSchema).max(10).optional(),
  split_pct: z.number().min(0.01).max(100).optional(),
  percent_base: z.enum(['gross', 'net_of_vat']).optional(),
  withholding_tax_pct: z.number().min(0).max(100).optional(),
  tax_residency: z.string().regex(/^[A-Z]{2}$/).optional(),
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

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }): Promise<Response> {
  const params = await props.params;
  return runAsPromoter(req, async (ctx) => {
    if (!(await assertOwner(params.id, ctx.promoterId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const r = await runWithServiceContext(() =>
      db().query(
        `SELECT a.id, a.artist_id, a.artist_name, a.artist_email,
                a.bank_iban, a.bank_bic, a.currency,
                a.royalty_type, a.percent_rate, a.flat_amount_halire,
                a.per_ticket_halire, a.min_guarantee_halire, a.cap_halire,
                a.deposit_minor, a.backend_pct, a.bonus_tiers, a.split_pct,
                a.percent_base, a.withholding_tax_pct, a.tax_residency,
                a.included_ticket_type_ids, a.status, a.notes,
                a.created_at,
                COALESCE(l.total_royalty, 0)::int AS accrued_halire,
                COALESCE(l.total_tickets, 0)::int AS tickets_sold,
                COALESCE(l.total_revenue, 0)::int AS revenue_halire
         FROM lineups.royalty_agreements a
         LEFT JOIN (
           SELECT agreement_id,
                  SUM(royalty_amount_halire) AS total_royalty,
                  SUM(tickets_sold)          AS total_tickets,
                  SUM(ticket_revenue_halire) AS total_revenue
           FROM lineups.royalty_ledger
           GROUP BY agreement_id
         ) l ON l.agreement_id = a.id
         WHERE a.event_id=$1
         ORDER BY a.created_at`,
        [params.id],
      ),
    );
    return NextResponse.json({ agreements: r.rows });
  });
}

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }): Promise<Response> {
  const params = await props.params;
  return runAsPromoter(req, async (ctx) => {
    if (!(await assertOwner(params.id, ctx.promoterId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const raw: unknown = await req.json().catch(() => ({}));
    const parsed = postSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json({ error: 'BAD_INPUT', issues: parsed.error.issues }, { status: 422 });
    }
    const b = parsed.data;
    const royaltyType = b.royalty_type ?? 'percent';

    // Kontrola smysluplnosti: strop pod garancí by znamenal, že garance nikdy
    // neplatí — to je skoro jistě překlep, ne záměr.
    if (
      b.cap_halire !== undefined &&
      b.min_guarantee_halire !== undefined &&
      b.cap_halire < b.min_guarantee_halire
    ) {
      return NextResponse.json(
        {
          error: 'CAP_BELOW_GUARANTEE',
          message: 'Strop honoráře je nižší než minimální garance — zkontroluj čísla.',
        },
        { status: 422 },
      );
    }

    // Měna smlouvy: buď zadaná, nebo měna pořadatele.
    const currency =
      b.currency ??
      (
        await runWithServiceContext(() =>
          db().query<{ primary_currency: string }>(
            `SELECT primary_currency FROM platform.promoters WHERE id=$1`,
            [ctx.promoterId],
          ),
        )
      ).rows[0]?.primary_currency ??
      'CZK';

    const r = await runWithServiceContext(() =>
      db().query(
        `INSERT INTO lineups.royalty_agreements
           (event_id, promoter_id, artist_id, artist_name, artist_email,
            bank_iban, bank_bic, royalty_type, percent_rate, flat_amount_halire,
            per_ticket_halire, min_guarantee_halire, cap_halire,
            included_ticket_type_ids, notes, currency,
            deposit_minor, backend_pct, bonus_tiers, split_pct,
            percent_base, withholding_tax_pct, tax_residency)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,
                 $17,$18,$19::jsonb,$20,$21,$22,$23)
         RETURNING *`,
        [
          params.id,
          ctx.promoterId,
          b.artist_id ?? null,
          b.artist_name,
          b.artist_email ?? null,
          b.bank_iban ?? null,
          b.bank_bic ?? null,
          royaltyType,
          b.percent_rate ?? null,
          b.flat_amount_halire ?? null,
          b.per_ticket_halire ?? null,
          b.min_guarantee_halire ?? null,
          b.cap_halire ?? null,
          b.included_ticket_type_ids ?? null,
          b.notes ?? null,
          currency,
          b.deposit_minor ?? 0,
          b.backend_pct ?? null,
          JSON.stringify(b.bonus_tiers ?? []),
          b.split_pct ?? 100,
          b.percent_base ?? 'gross',
          b.withholding_tax_pct ?? 0,
          b.tax_residency ?? null,
        ],
      ),
    );
    return NextResponse.json(r.rows[0], { status: 201 });
  });
}
