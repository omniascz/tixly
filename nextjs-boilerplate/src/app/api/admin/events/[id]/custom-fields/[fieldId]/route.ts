/**
 * PATCH/DELETE /api/admin/events/[id]/custom-fields/[fieldId]
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsPromoterNonStaff } from '@/lib/admin-auth';
import { z } from 'zod';


const patchSchema = z.object({
  label: z.string().min(2).max(200).optional(),
  helpText: z.string().max(500).nullable().optional(),
  required: z.boolean().optional(),
  displayOrder: z.number().int().min(0).max(1000).optional(),
  options: z.array(z.object({ value: z.string(), label: z.string() })).max(50).optional(),
});

export async function PATCH(
  req: NextRequest,
  props: { params: Promise<{ id: string; fieldId: string }> }
): Promise<Response> {
  const params = await props.params;
  return runAsPromoterNonStaff(req, async (promoter) => {
  const body: unknown = await req.json().catch(() => ({}));
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'INVALID_BODY' }, { status: 422 });
  }

  const updates: string[] = [];
  const args: unknown[] = [params.fieldId, params.id, promoter.promoterId];

  function add(col: string, val: unknown) {
    args.push(val);
    updates.push(`${col} = $${args.length}`);
  }
  if (parsed.data.label !== undefined) add('label', parsed.data.label);
  if (parsed.data.helpText !== undefined) add('help_text', parsed.data.helpText);
  if (parsed.data.required !== undefined) add('required', parsed.data.required);
  if (parsed.data.displayOrder !== undefined) add('display_order', parsed.data.displayOrder);
  if (parsed.data.options !== undefined) {
    args.push(JSON.stringify(parsed.data.options));
    updates.push(`options = $${args.length}::jsonb`);
  }

  if (updates.length === 0) return NextResponse.json({ ok: true, noop: true });

  const r = await db().query(
    `UPDATE catalog.event_custom_fields cf
        SET ${updates.join(', ')}, updated_at = now()
       FROM catalog.events e
      WHERE cf.id = $1 AND cf.event_id = $2
        AND e.id = cf.event_id AND e.promoter_id = $3
    RETURNING cf.id`,
    args,
  );
  if (r.rows.length === 0) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }
  return NextResponse.json({ ok: true });

  });
}

export async function DELETE(
  req: NextRequest,
  props: { params: Promise<{ id: string; fieldId: string }> }
): Promise<Response> {
  const params = await props.params;
  return runAsPromoterNonStaff(req, async (promoter) => {
  const r = await db().query(
    `DELETE FROM catalog.event_custom_fields cf
      USING catalog.events e
      WHERE cf.id = $1 AND cf.event_id = $2
        AND e.id = cf.event_id AND e.promoter_id = $3
    RETURNING cf.id`,
    [params.fieldId, params.id, promoter.promoterId],
  );
  if (r.rows.length === 0) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }
  return NextResponse.json({ deleted: true });

  });
}
