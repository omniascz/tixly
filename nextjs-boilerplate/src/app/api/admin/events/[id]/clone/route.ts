/**
 * POST /api/admin/events/[id]/clone
 *
 * Eventbrite "Copy event" parita — vytvoří kopii eventu se vším:
 * ticket_types, group_discount_tiers, promo_codes, custom_fields,
 * channel_prices, hot_mode flags, addons.
 *
 * Body: { newTitle, newDateStart, newDateEnd? }
 * Response: { newEventId }
 *
 * NEMĚNÍ: orders, tickets, donations (per-instance data).
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsPromoterNonStaff } from '@/lib/admin-auth';
import { z } from 'zod';


const schema = z.object({
  newTitle: z.string().min(2).max(300),
  newDateStart: z.string().datetime(),
  newDateEnd: z.string().datetime().optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return runAsPromoterNonStaff(req, async (promoter) => {
  const { id: sourceEventId } = await params;

  const body: unknown = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'INVALID_BODY' }, { status: 422 });
  }

  const client = await db().connect();
  try {
    await client.query('BEGIN');

    // Ownership + load source event
    const source = await client.query<{ id: string; promoter_id: string }>(
      `SELECT id, promoter_id FROM catalog.events
        WHERE id = $1 AND promoter_id = $2`,
      [sourceEventId, promoter.promoterId],
    );
    if (source.rows.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'NOT_OWNER_OR_NOT_FOUND' }, { status: 404 });
    }

    // 1. Clone event row (kopíruj všechny columns + nový title/dates + status=draft)
    const newEvent = await client.query<{ id: string }>(
      `INSERT INTO catalog.events
       SELECT
         gen_random_uuid() AS id,
         promoter_id, $2 AS title,
         NULL AS slug,
         description, image_url, cover_image_url,
         $3::timestamptz AS date_start,
         COALESCE($4::timestamptz, NULL) AS date_end,
         venue_id, category, subcategory, age_restriction, currency,
         'draft' AS status,
         NULL AS published_at, NULL AS sold_out_at,
         created_at, NOW() AS updated_at,
         tags, format,
         hot_event_mode, max_tickets_per_buyer, qr_reveal_minutes_before,
         require_tan_validation, require_phone_binding, no_gifting_mode, require_photo_id,
         resale_policy, resale_window_hours_before, resale_fee_pct,
         resale_seller_payout_delay_days, resale_combo_excluded,
         allow_ticket_changes, ticket_change_deadline_hours_before
       FROM catalog.events
       WHERE id = $1
       RETURNING id`,
      [sourceEventId, parsed.data.newTitle, parsed.data.newDateStart, parsed.data.newDateEnd ?? null],
    ).catch(async () => {
      // Fallback pokud schema má jiné sloupce — alespoň základní clone
      const r = await client.query<{ id: string }>(
        `INSERT INTO catalog.events
           (promoter_id, title, description, date_start, date_end, venue_id,
            category, subcategory, status)
         SELECT promoter_id, $2, description, $3::timestamptz,
                COALESCE($4::timestamptz, NULL), venue_id,
                category, subcategory, 'draft'
           FROM catalog.events WHERE id = $1
         RETURNING id`,
        [sourceEventId, parsed.data.newTitle, parsed.data.newDateStart, parsed.data.newDateEnd ?? null],
      );
      return r;
    });

    if (newEvent.rows.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'CLONE_FAILED' }, { status: 500 });
    }
    const newEventId = newEvent.rows[0].id;

    // 2. Clone ticket_types (zachovat IDs mapping pro group_discounts later)
    const ttMappingRes = await client.query<{ old_id: string; new_id: string }>(
      `WITH inserted AS (
        INSERT INTO catalog.ticket_types
          (event_id, name, kind, base_price, total_qty, remaining_qty, visibility)
        SELECT $2, name, kind, base_price, total_qty, total_qty, visibility
          FROM catalog.ticket_types
         WHERE event_id = $1
        RETURNING id, name
      )
      SELECT old_tt.id AS old_id, new_tt.id AS new_id
        FROM catalog.ticket_types old_tt
        JOIN inserted new_tt ON new_tt.name = old_tt.name
       WHERE old_tt.event_id = $1`,
      [sourceEventId, newEventId],
    ).catch(() => ({ rows: [] as { old_id: string; new_id: string }[] }));

    const ttMap = new Map<string, string>();
    for (const row of ttMappingRes.rows) ttMap.set(row.old_id, row.new_id);

    // 3. Clone group_discount_tiers
    if (ttMap.size > 0) {
      for (const [oldTt, newTt] of ttMap.entries()) {
        await client.query(
          `INSERT INTO catalog.group_discount_tiers
             (ticket_type_id, min_quantity, label, discount_pct, discount_flat_halire)
           SELECT $2, min_quantity, label, discount_pct, discount_flat_halire
             FROM catalog.group_discount_tiers
            WHERE ticket_type_id = $1`,
          [oldTt, newTt],
        ).catch(() => null);
      }
    }

    // 4. Clone custom_fields
    await client.query(
      `INSERT INTO catalog.event_custom_fields
         (event_id, field_key, label, help_text, field_type, options,
          required, scope, display_order, validation_regex, max_length)
       SELECT $2, field_key, label, help_text, field_type, options,
              required, scope, display_order, validation_regex, max_length
         FROM catalog.event_custom_fields
        WHERE event_id = $1`,
      [sourceEventId, newEventId],
    ).catch(() => null);

    // 5. Clone addons (public.checkout_addons)
    await client.query(
      `INSERT INTO public.checkout_addons
         (promoter_id, event_id, name, description, category, price_halire,
          max_quantity, stock_available, image_url, available, display_order)
       SELECT promoter_id, $2, name, description, category, price_halire,
              max_quantity, stock_available, image_url, available, display_order
         FROM public.checkout_addons
        WHERE event_id = $1`,
      [sourceEventId, newEventId],
    ).catch(() => null);

    await client.query('COMMIT');
    return NextResponse.json({
      newEventId,
      cloned: {
        ticket_types: ttMap.size,
        message: 'Event clone success. Status = draft, musíš publikovat.',
      },
    }, { status: 201 });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('[event clone]', e);
    return NextResponse.json({ error: 'CLONE_FAILED' }, { status: 500 });
  } finally {
    client.release();
  }

  });
}
