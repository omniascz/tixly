/**
 * GET /api/public/events/[id]/custom-fields
 *
 * Public endpoint — vrátí čekající fields k vyplnění při checkoutu.
 * Filtruje pouze ty, které jsou aktuálně visible (visible_from/until).
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';


export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }): Promise<Response> {
  const params = await props.params;
  const r = await db().query<{
    id: string;
    field_key: string;
    label: string;
    help_text: string | null;
    field_type: string;
    options: unknown;
    required: boolean;
    scope: string;
    display_order: number;
    max_length: number | null;
  }>(
    `SELECT id, field_key, label, help_text, field_type, options, required, scope,
            display_order, max_length
       FROM catalog.event_custom_fields
      WHERE event_id = $1
        AND (visible_from IS NULL OR visible_from <= now())
        AND (visible_until IS NULL OR visible_until > now())
   ORDER BY display_order, created_at`,
    [params.id],
  );

  return NextResponse.json({ fields: r.rows });
}
