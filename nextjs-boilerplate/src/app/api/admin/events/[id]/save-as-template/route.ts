/**
 * POST /api/admin/events/[id]/save-as-template
 *
 * Uloží aktuální konfiguraci akce (ticket types, group discounts, VIP bundle)
 * jako novou šablonu promotéra.
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsActivePromoter } from '@/lib/admin-auth';
import { z } from 'zod';

const schema = z.object({
  name: z.string().min(2).max(200),
  description: z.string().max(2000).optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  return runAsActivePromoter(req, async (promoter) => {
    if (!/^[0-9a-f-]{36}$/i.test(params.id)) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 422 });
    }

    const body: unknown = await req.json().catch(() => ({}));
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', issues: parsed.error.issues }, { status: 422 });
    }
    const input = parsed.data;

    // Verify ownership
    const ev = await db().query<{ id: string; cover_image_url: string | null }>(
      `SELECT id, cover_image_url FROM catalog.events WHERE id = $1 AND promoter_id = $2 LIMIT 1`,
      [params.id, promoter.promoterId],
    );
    if (ev.rows.length === 0) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    // Gather ticket types
    const tts = await db().query<{
      name: string; description: string | null;
      base_price: number; total_qty: number;
      max_per_user: number | null; zone: string | null;
    }>(
      `SELECT name, description, base_price, total_qty, max_per_user, zone
       FROM catalog.ticket_types WHERE event_id = $1 ORDER BY created_at`,
      [params.id],
    );

    // Gather group discounts
    const gd = await db().query<{
      min_quantity: number; label: string; discount_pct: number | null;
    }>(
      `SELECT min_quantity, label, discount_pct
       FROM catalog.group_discounts WHERE event_id = $1 ORDER BY min_quantity`,
      [params.id],
    ).catch(() => ({ rows: [] as { min_quantity: number; label: string; discount_pct: number | null }[] }));

    // Gather VIP bundle if any
    const bundle = await db().query<{ name: string; description: string | null; base_price: number }>(
      `SELECT name, description, base_price FROM catalog.event_bundles
       WHERE event_id = $1 AND is_vip = true LIMIT 1`,
      [params.id],
    ).catch(() => ({ rows: [] as { name: string; description: string | null; base_price: number }[] }));

    const templateData = {
      ticket_types: tts.rows.map((t) => ({
        name: t.name,
        description: t.description,
        base_price: t.base_price,
        total_qty: t.total_qty,
        max_per_user: t.max_per_user,
        zone: t.zone,
      })),
      group_discounts: gd.rows,
      ...(bundle.rows[0]
        ? {
            vip_package: {
              name: bundle.rows[0].name,
              description: bundle.rows[0].description ?? '',
              price: bundle.rows[0].base_price,
              benefits: [],
            },
          }
        : {}),
    };

    const r = await db().query<{ id: string }>(
      `INSERT INTO catalog.event_templates
         (promoter_id, name, description, template_type, template_data,
          preview_image_url, is_active, created_at)
       VALUES ($1, $2, $3, 'full_event', $4, $5, true, NOW())
       RETURNING id`,
      [
        promoter.promoterId,
        input.name,
        input.description ?? null,
        JSON.stringify(templateData),
        ev.rows[0].cover_image_url,
      ],
    );

    return NextResponse.json({ id: r.rows[0].id }, { status: 201 });
  });
}
