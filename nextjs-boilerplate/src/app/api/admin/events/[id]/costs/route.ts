/**
 * GET  /api/admin/events/[id]/costs — položkový rozpočet akce + souhrn
 * POST /api/admin/events/[id]/costs — přidá položku
 *
 * Rozpočet je základ pro bod zlomu (viz /break-even) i pro vyúčtování
 * s umělcem. Položky odvozené ze smlouvy s umělcem (honorář) sem nejdou
 * zadat ručně — vznikají schválením nabídky a editují se u smlouvy, aby se
 * číslo v rozpočtu nerozešlo s číslem ve smlouvě.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { runAsActivePromoter, runAsPromoter } from '@/lib/admin-auth';
import { summarizeCosts } from '@/lib/budget/break-even';
import { db } from '@/lib/db/rls-pool';
import { COST_CATEGORIES } from '@/lib/budget/cost-categories';


const postSchema = z.object({
  category: z.enum(COST_CATEGORIES),
  description: z.string().min(1).max(200),
  amountMinor: z.number().int().min(0).max(1_000_000_000),
  vatRatePct: z.number().int().min(0).max(100).optional(),
  isPerAttendee: z.boolean().optional(),
  supplier: z.string().max(200).optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  notes: z.string().max(1000).optional(),
});

interface CostRow {
  id: string;
  category: string;
  description: string;
  amount_minor: number;
  vat_rate_pct: number;
  is_per_attendee: boolean;
  supplier: string | null;
  due_date: string | null;
  paid: boolean;
  royalty_agreement_id: string | null;
  notes: string | null;
}

async function ownsEvent(eventId: string, promoterId: string): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/i.test(eventId)) return false;
  const r = await db().query(
    `SELECT 1 FROM catalog.events WHERE id = $1 AND promoter_id = $2 LIMIT 1`,
    [eventId, promoterId],
  );
  return r.rows.length > 0;
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  return runAsPromoter(req, async (ctx) => {
    if (!(await ownsEvent(params.id, ctx.promoterId))) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const rows = await db().query<CostRow>(
      `SELECT id, category, description, amount_minor, vat_rate_pct,
              is_per_attendee, supplier, due_date::text, paid,
              royalty_agreement_id, notes
       FROM catalog.event_costs
       WHERE event_id = $1
       ORDER BY is_per_attendee, category, created_at`,
      [params.id],
    );

    const vatPayerRes = await db().query<{ vat_payer: boolean }>(
      `SELECT vat_payer FROM platform.promoters WHERE id = $1`,
      [ctx.promoterId],
    );
    const vatPayer = vatPayerRes.rows[0]?.vat_payer ?? true;

    const summary = summarizeCosts(
      rows.rows.map((r) => ({
        amountMinor: r.amount_minor,
        vatRatePct: r.vat_rate_pct,
        isPerAttendee: r.is_per_attendee,
      })),
      vatPayer,
    );

    // Součet podle kategorií — promotér chce vidět, kde peníze mizí.
    const byCategory: Record<string, number> = {};
    for (const r of rows.rows) {
      byCategory[r.category] = (byCategory[r.category] ?? 0) + r.amount_minor;
    }

    return NextResponse.json({
      costs: rows.rows.map((r) => ({
        id: r.id,
        category: r.category,
        description: r.description,
        amountMinor: r.amount_minor,
        vatRatePct: r.vat_rate_pct,
        isPerAttendee: r.is_per_attendee,
        supplier: r.supplier,
        dueDate: r.due_date,
        paid: r.paid,
        /** Odvozeno ze smlouvy s umělcem — v rozpočtu jen ke čtení. */
        fromAgreement: r.royalty_agreement_id !== null,
        notes: r.notes,
      })),
      summary: {
        fixedMinor: summary.fixedMinor,
        perAttendeeMinor: summary.perAttendeeMinor,
        fixedVatMinor: summary.fixedVatMinor,
        vatPayer,
        byCategory,
      },
    });
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  return runAsActivePromoter(req, async (promoter) => {
    if (!(await ownsEvent(params.id, promoter.promoterId))) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const raw: unknown = await req.json().catch(() => ({}));
    const parsed = postSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'BAD_INPUT', issues: parsed.error.issues },
        { status: 422 },
      );
    }
    const b = parsed.data;

    const r = await db().query<{ id: string }>(
      `INSERT INTO catalog.event_costs
         (event_id, promoter_id, category, description, amount_minor,
          vat_rate_pct, is_per_attendee, supplier, due_date, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING id`,
      [
        params.id,
        promoter.promoterId,
        b.category,
        b.description,
        b.amountMinor,
        b.vatRatePct ?? 21,
        b.isPerAttendee ?? false,
        b.supplier ?? null,
        b.dueDate ?? null,
        b.notes ?? null,
      ],
    );

    return NextResponse.json({ ok: true, id: r.rows[0].id }, { status: 201 });
  });
}
