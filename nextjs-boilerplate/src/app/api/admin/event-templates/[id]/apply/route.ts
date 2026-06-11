/**
 * POST /api/admin/event-templates/[id]/apply
 *
 * Aplikuje template na event. Body: { eventId }.
 * Podle template_type kopíruje různé entity (ticket_types, group_discounts, ...).
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsPromoterNonStaff } from '@/lib/admin-auth';
import { z } from 'zod';


const schema = z.object({
  eventId: z.string().uuid(),
});

interface TicketTypeTemplate {
  name: string;
  description?: string;
  base_price?: number;
  total_qty?: number;
  visibility?: string;
}
interface DiscountTemplate {
  min_quantity: number;
  label: string;
  discount_pct?: number;
}

interface TemplateData {
  ticket_types?: TicketTypeTemplate[];
  group_discounts?: DiscountTemplate[];
  presale_settings?: {
    start_offset_hours: number;
    end_offset_hours: number;
    access_code?: string;
  };
  vip_package?: {
    name: string;
    description: string;
    price: number;
    benefits: string[];
  };
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  return runAsPromoterNonStaff(req, async (promoter) => {
  const body: unknown = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_BODY' }, { status: 422 });

  const client = await db().connect();
  try {
    await client.query('BEGIN');

    const tpl = await client.query<{
      template_type: string;
      template_data: TemplateData;
    }>(
      `SELECT template_type, template_data
         FROM catalog.event_templates
        WHERE id = $1 AND promoter_id = $2 AND is_active = true`,
      [params.id, promoter.promoterId],
    );

    if (tpl.rows.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'TEMPLATE_NOT_FOUND' }, { status: 404 });
    }

    // Verify event ownership
    const own = await client.query(
      `SELECT 1 FROM catalog.events WHERE id = $1 AND promoter_id = $2`,
      [parsed.data.eventId, promoter.promoterId],
    );
    if (own.rows.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'NOT_OWNER' }, { status: 403 });
    }

    const data = tpl.rows[0].template_data;
    const applied = { ticket_types: 0, group_discounts: 0, vip_package: 0, presale: 0 };

    // Apply ticket types
    if (data.ticket_types) {
      for (const tt of data.ticket_types) {
        await client.query(
          `INSERT INTO catalog.ticket_types
             (event_id, name, description, base_price, total_qty, remaining_qty, visibility)
           VALUES ($1, $2, $3, $4, $5, $5, $6)`,
          [
            parsed.data.eventId, tt.name, tt.description ?? null,
            tt.base_price ?? 0, tt.total_qty ?? 100, tt.visibility ?? 'public',
          ],
        );
        applied.ticket_types++;
      }
    }

    // Apply VIP package as additional ticket_type
    if (data.vip_package) {
      const vip = data.vip_package;
      await client.query(
        `INSERT INTO catalog.ticket_types
           (event_id, name, description, base_price, total_qty, remaining_qty, visibility)
         VALUES ($1, $2, $3, $4, $5, $5, 'public')`,
        [
          parsed.data.eventId,
          vip.name,
          vip.description + '\n\n' + (vip.benefits ?? []).map((b) => `• ${b}`).join('\n'),
          vip.price, 10,
        ],
      );
      applied.vip_package = 1;
    }

    await client.query(
      `UPDATE catalog.event_templates SET usage_count = usage_count + 1 WHERE id = $1`,
      [params.id],
    );

    await client.query('COMMIT');
    return NextResponse.json({ ok: true, applied });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('[POST /api/admin/event-templates/[id]/apply]', e);
    return NextResponse.json({ error: 'APPLY_FAILED' }, { status: 500 });
  } finally {
    client.release();
  }

  });
}
