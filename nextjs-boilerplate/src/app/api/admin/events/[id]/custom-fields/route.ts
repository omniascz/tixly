/**
 * GET/POST /api/admin/events/[id]/custom-fields
 *
 * Custom checkout fields builder. Promotér si nakliká vlastní otázky
 * (Eventim "doplňkové otázky" v shopu).
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsPromoter, runAsPromoterNonStaff } from '@/lib/admin-auth';
import { z } from 'zod';


const postSchema = z.object({
  fieldKey: z.string().regex(/^[a-z][a-z0-9_]{1,40}$/, 'snake_case key'),
  label: z.string().min(2).max(200),
  helpText: z.string().max(500).optional(),
  fieldType: z.enum(['text', 'textarea', 'select', 'multiselect', 'checkbox', 'radio', 'email', 'phone', 'date', 'number']),
  options: z.array(z.object({ value: z.string(), label: z.string() })).max(50).optional(),
  required: z.boolean().default(false),
  scope: z.enum(['order', 'ticket']).default('order'),
  displayOrder: z.number().int().min(0).max(1000).default(100),
  visibleFrom: z.string().datetime().optional(),
  visibleUntil: z.string().datetime().optional(),
  validationRegex: z.string().max(500).optional(),
  maxLength: z.number().int().min(1).max(10000).optional(),
});

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return runAsPromoter(req, async (promoter) => {
  const { id: eventId } = await params;

  const r = await db().query(
    `SELECT cf.*
       FROM catalog.event_custom_fields cf
       JOIN catalog.events e ON e.id = cf.event_id
      WHERE cf.event_id = $1 AND e.promoter_id = $2
   ORDER BY cf.display_order, cf.created_at`,
    [eventId, promoter.promoterId],
  );
  return NextResponse.json({ fields: r.rows });

  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return runAsPromoterNonStaff(req, async (promoter) => {
  const { id: eventId } = await params;

  const body: unknown = await req.json().catch(() => ({}));
  const parsed = postSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'INVALID_BODY', issues: parsed.error.issues }, { status: 422 });
  }

  // Ownership
  const own = await db().query(
    `SELECT 1 FROM catalog.events WHERE id = $1 AND promoter_id = $2`,
    [eventId, promoter.promoterId],
  );
  if (own.rows.length === 0) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }

  // Validation: select/multiselect/radio require options
  if (['select', 'multiselect', 'radio'].includes(parsed.data.fieldType) &&
      (!parsed.data.options || parsed.data.options.length === 0)) {
    return NextResponse.json({
      error: 'OPTIONS_REQUIRED',
      message: 'Pole typu select/multiselect/radio vyžaduje alespoň jednu volbu.',
    }, { status: 422 });
  }

  const d = parsed.data;
  try {
    const r = await db().query<{ id: string }>(
      `INSERT INTO catalog.event_custom_fields
         (event_id, field_key, label, help_text, field_type, options, required, scope,
          display_order, visible_from, visible_until, validation_regex, max_length)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10::timestamptz, $11::timestamptz, $12, $13)
       RETURNING id`,
      [
        eventId, d.fieldKey, d.label, d.helpText ?? null, d.fieldType,
        d.options ? JSON.stringify(d.options) : null,
        d.required, d.scope, d.displayOrder,
        d.visibleFrom ?? null, d.visibleUntil ?? null,
        d.validationRegex ?? null, d.maxLength ?? null,
      ],
    );
    return NextResponse.json({ id: r.rows[0].id }, { status: 201 });
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === '23505') {
      return NextResponse.json({ error: 'DUPLICATE_KEY' }, { status: 409 });
    }
    return NextResponse.json({ error: 'DB_ERROR' }, { status: 500 });
  }

  });
}
