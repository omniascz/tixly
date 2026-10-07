/**
 * PATCH  /api/admin/events/[id]/costs/[costId] — úprava položky rozpočtu
 * DELETE /api/admin/events/[id]/costs/[costId] — smazání položky
 *
 * Položku odvozenou ze smlouvy s umělcem nelze upravit ani smazat — částka
 * musí zůstat totožná s honorářem ve smlouvě. Kdo chce jiné číslo, mění smlouvu.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { runAsActivePromoter } from '@/lib/admin-auth';
import { COST_CATEGORIES } from '@/lib/budget/cost-categories';
import { db } from '@/lib/db/rls-pool';

const patchSchema = z.object({
  category: z.enum(COST_CATEGORIES).optional(),
  description: z.string().min(1).max(200).optional(),
  amountMinor: z.number().int().min(0).max(1_000_000_000).optional(),
  vatRatePct: z.number().int().min(0).max(100).optional(),
  isPerAttendee: z.boolean().optional(),
  supplier: z.string().max(200).nullable().optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  paid: z.boolean().optional(),
  notes: z.string().max(1000).nullable().optional(),
});

/** Vrátí položku, pokud patří pořadateli a akci. */
async function loadCost(
  eventId: string,
  costId: string,
  promoterId: string,
): Promise<{ id: string; fromAgreement: boolean } | null> {
  if (!/^[0-9a-f-]{36}$/i.test(eventId) || !/^[0-9a-f-]{36}$/i.test(costId)) return null;
  const r = await db().query<{ id: string; royalty_agreement_id: string | null }>(
    `SELECT c.id, c.royalty_agreement_id
     FROM catalog.event_costs c
     JOIN catalog.events e ON e.id = c.event_id
     WHERE c.id = $1 AND c.event_id = $2 AND e.promoter_id = $3
     LIMIT 1`,
    [costId, eventId, promoterId],
  );
  const row = r.rows[0];
  if (!row) return null;
  return { id: row.id, fromAgreement: row.royalty_agreement_id !== null };
}

export async function PATCH(
  req: NextRequest,
  props: { params: Promise<{ id: string; costId: string }> }
): Promise<Response> {
  const params = await props.params;
  return runAsActivePromoter(req, async (promoter) => {
    const cost = await loadCost(params.id, params.costId, promoter.promoterId);
    if (!cost) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (cost.fromAgreement) {
      return NextResponse.json(
        {
          error: 'DERIVED_FROM_AGREEMENT',
          message: 'Honorář se upravuje ve smlouvě s umělcem, ne v rozpočtu.',
        },
        { status: 409 },
      );
    }

    const raw: unknown = await req.json().catch(() => ({}));
    const parsed = patchSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json({ error: 'BAD_INPUT', issues: parsed.error.issues }, { status: 422 });
    }
    const b = parsed.data;

    const sets: string[] = [];
    const args: unknown[] = [];
    const add = (col: string, val: unknown): void => {
      args.push(val);
      sets.push(`${col} = $${args.length}`);
    };
    if (b.category !== undefined) add('category', b.category);
    if (b.description !== undefined) add('description', b.description);
    if (b.amountMinor !== undefined) add('amount_minor', b.amountMinor);
    if (b.vatRatePct !== undefined) add('vat_rate_pct', b.vatRatePct);
    if (b.isPerAttendee !== undefined) add('is_per_attendee', b.isPerAttendee);
    if (b.supplier !== undefined) add('supplier', b.supplier);
    if (b.dueDate !== undefined) add('due_date', b.dueDate);
    if (b.notes !== undefined) add('notes', b.notes);
    if (b.paid !== undefined) {
      add('paid', b.paid);
      sets.push(`paid_at = ${b.paid ? 'NOW()' : 'NULL'}`);
    }

    if (sets.length === 0) {
      return NextResponse.json({ error: 'NOTHING_TO_UPDATE' }, { status: 422 });
    }

    args.push(params.costId);
    await db().query(
      `UPDATE catalog.event_costs SET ${sets.join(', ')}, updated_at = NOW()
       WHERE id = $${args.length}`,
      args,
    );

    return NextResponse.json({ ok: true });
  });
}

export async function DELETE(
  req: NextRequest,
  props: { params: Promise<{ id: string; costId: string }> }
): Promise<Response> {
  const params = await props.params;
  return runAsActivePromoter(req, async (promoter) => {
    const cost = await loadCost(params.id, params.costId, promoter.promoterId);
    if (!cost) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (cost.fromAgreement) {
      return NextResponse.json(
        {
          error: 'DERIVED_FROM_AGREEMENT',
          message: 'Honorář z rozpočtu zmizí zrušením smlouvy s umělcem.',
        },
        { status: 409 },
      );
    }

    await db().query(`DELETE FROM catalog.event_costs WHERE id = $1`, [params.costId]);
    return NextResponse.json({ ok: true });
  });
}
