/**
 * GET  /api/admin/events/[id]/distribution — stav distribuce + seznam partnerů
 * PATCH /api/admin/events/[id]/distribution — zapnout/vypnout, alokace, provize
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsActivePromoter } from '@/lib/admin-auth';
import { z } from 'zod';

const patchSchema = z.object({
  distributionEnabled: z.boolean().optional(),
  partners: z
    .array(
      z.object({
        partnerId: z.string().uuid(),
        active: z.boolean(),
        allocationQty: z.number().int().min(1).nullable().optional(),
        commissionOverridePct: z.number().min(0).max(100).nullable().optional(),
      }),
    )
    .optional(),
});

async function ensureOwnership(eventId: string, promoterId: string) {
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
  return runAsActivePromoter(req, async (promoter) => {
    if (!/^[0-9a-f-]{36}$/i.test(params.id)) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 422 });
    }
    if (!(await ensureOwnership(params.id, promoter.promoterId))) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const [eventRow, allPartners, eventPartners] = await Promise.all([
      db().query<{ distribution_enabled: boolean }>(
        `SELECT COALESCE(distribution_enabled, false) AS distribution_enabled
         FROM catalog.events WHERE id = $1`,
        [params.id],
      ),
      db().query<{
        id: string;
        name: string;
        commission_pct: number;
        status: string;
        contact_email: string;
      }>(
        `SELECT id, name, commission_pct, status, contact_email
         FROM platform.reseller_partners
         WHERE status = 'active'
         ORDER BY name`,
      ),
      db().query<{
        partner_id: string;
        allocation_qty: number | null;
        commission_override_pct: number | null;
        active: boolean;
      }>(
        `SELECT partner_id, allocation_qty, commission_override_pct, active
         FROM catalog.event_distribution_partners
         WHERE event_id = $1`,
        [params.id],
      ),
    ]);

    const partnerMap = new Map(eventPartners.rows.map((r) => [r.partner_id, r]));

    return NextResponse.json({
      distributionEnabled: eventRow.rows[0]?.distribution_enabled ?? false,
      partners: allPartners.rows.map((p) => {
        const ep = partnerMap.get(p.id);
        return {
          id: p.id,
          name: p.name,
          defaultCommissionPct: p.commission_pct,
          contactEmail: p.contact_email,
          assigned: !!ep,
          active: ep?.active ?? false,
          allocationQty: ep?.allocation_qty ?? null,
          commissionOverridePct: ep?.commission_override_pct ?? null,
        };
      }),
    });
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  return runAsActivePromoter(req, async (promoter) => {
    if (!/^[0-9a-f-]{36}$/i.test(params.id)) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 422 });
    }
    if (!(await ensureOwnership(params.id, promoter.promoterId))) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const body: unknown = await req.json().catch(() => ({}));
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', issues: parsed.error.issues }, { status: 422 });
    }
    const input = parsed.data;

    const client = await db().connect();
    try {
      await client.query('BEGIN');

      if (input.distributionEnabled !== undefined) {
        await client.query(
          `UPDATE catalog.events SET distribution_enabled = $1, updated_at = NOW() WHERE id = $2`,
          [input.distributionEnabled, params.id],
        );
      }

      if (input.partners) {
        for (const p of input.partners) {
          await client.query(
            `INSERT INTO catalog.event_distribution_partners
               (event_id, partner_id, allocation_qty, commission_override_pct, active)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (event_id, partner_id) DO UPDATE
               SET allocation_qty = EXCLUDED.allocation_qty,
                   commission_override_pct = EXCLUDED.commission_override_pct,
                   active = EXCLUDED.active`,
            [
              params.id,
              p.partnerId,
              p.allocationQty ?? null,
              p.commissionOverridePct ?? null,
              p.active,
            ],
          );
        }
      }

      await client.query('COMMIT');
      return NextResponse.json({ ok: true });
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('[PATCH /distribution]', err);
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    } finally {
      client.release();
    }
  });
}
