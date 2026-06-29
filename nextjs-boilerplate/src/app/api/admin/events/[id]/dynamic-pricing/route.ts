/**
 * GET   /api/admin/events/[id]/dynamic-pricing  — settings, rules, log
 * PATCH /api/admin/events/[id]/dynamic-pricing  — enable/disable + add rule
 * DELETE /api/admin/events/[id]/dynamic-pricing  — delete rule (?rule_id=)
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsPromoter } from '@/lib/admin-auth';
import { computeDemandMetrics } from '@/lib/pricing/dynamic-engine';

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  return runAsPromoter(req, async (ctx) => {
    const eventR = await db().query(
      `SELECT e.id, e.title, e.dynamic_pricing_enabled, e.date_start,
              (SELECT COUNT(*)::int FROM tickets.tickets t
                JOIN orders.orders o ON o.id = t.order_id
                WHERE o.event_id = e.id AND o.status = 'paid') AS tickets_sold
       FROM catalog.events e
       WHERE e.id = $1 AND e.promoter_id = $2`,
      [params.id, ctx.promoterId],
    );
    if (eventR.rows.length === 0) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const [rulesR, ticketTypesR, logR, metricsRaw] = await Promise.all([
      db().query(
        `SELECT * FROM pricing.dynamic_pricing_rules
         WHERE event_id = $1 ORDER BY priority DESC, created_at`,
        [params.id],
      ),
      db().query(
        `SELECT id, name, base_price, dynamic_price_minor, dp_min_halire, dp_max_halire,
                dynamic_pricing_enabled, total_qty, remaining_qty
         FROM catalog.ticket_types WHERE event_id = $1
         ORDER BY name`,
        [params.id],
      ),
      db().query(
        `SELECT pal.*, tt.name AS ticket_type_name
         FROM pricing.price_adjustment_log pal
         JOIN catalog.ticket_types tt ON tt.id = pal.ticket_type_id
         WHERE pal.event_id = $1
         ORDER BY pal.applied_at DESC LIMIT 50`,
        [params.id],
      ),
      computeDemandMetrics(params.id),
    ]);

    return NextResponse.json({
      event:        eventR.rows[0],
      rules:        rulesR.rows,
      ticket_types: ticketTypesR.rows,
      log:          logR.rows,
      metrics:      metricsRaw,
    });
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  return runAsPromoter(req, async (ctx) => {
    const b = await req.json() as {
      // Event-level toggle
      dynamic_pricing_enabled?: boolean;

      // Ticket type settings
      ticket_type_id?: string;
      dp_enabled?: boolean;
      dp_min_halire?: number;
      dp_max_halire?: number;

      // Add/update rule
      rule?: {
        id?: string;  // if present = update existing
        rule_type: string;
        trigger_condition: Record<string, number>;
        price_adjustment: { type: string; value: number };
        applies_to?: string;
        max_price_multiplier?: number;
        min_price_multiplier?: number;
        priority?: number;
        is_active?: boolean;
      };
    };

    // Verify ownership
    const own = await db().query(
      `SELECT id FROM catalog.events WHERE id=$1 AND promoter_id=$2 LIMIT 1`,
      [params.id, ctx.promoterId],
    );
    if (own.rows.length === 0) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    // 1. Toggle event-level DP
    if (typeof b.dynamic_pricing_enabled === 'boolean') {
      await db().query(
        `UPDATE catalog.events SET dynamic_pricing_enabled=$1 WHERE id=$2`,
        [b.dynamic_pricing_enabled, params.id],
      );
    }

    // 2. Toggle ticket type DP
    if (b.ticket_type_id) {
      if (b.dp_enabled === true) {
        await db().query(
          `UPDATE catalog.ticket_types
           SET dynamic_pricing_enabled = true,
               dp_min_halire = $2,
               dp_max_halire = $3
           WHERE id = $1 AND event_id = $4`,
          [b.ticket_type_id, b.dp_min_halire ?? null, b.dp_max_halire ?? null, params.id],
        );
      } else if (b.dp_enabled === false) {
        // Clear dynamic price override when disabling
        await db().query(
          `UPDATE catalog.ticket_types
           SET dynamic_pricing_enabled = false,
               dynamic_price_minor = NULL,
               dynamic_price_updated_at = NULL
           WHERE id = $1 AND event_id = $2`,
          [b.ticket_type_id, params.id],
        );
      } else if (b.dp_min_halire !== undefined || b.dp_max_halire !== undefined) {
        await db().query(
          `UPDATE catalog.ticket_types
           SET dp_min_halire = COALESCE($2, dp_min_halire),
               dp_max_halire = COALESCE($3, dp_max_halire)
           WHERE id = $1 AND event_id = $4`,
          [b.ticket_type_id, b.dp_min_halire ?? null, b.dp_max_halire ?? null, params.id],
        );
      }
    }

    // 3. Add or update rule
    if (b.rule) {
      const r = b.rule;

      // Validate rule
      const VALID_TYPES = ['capacity_threshold','time_decay','last_minute','early_bird','velocity_surge'];
      if (!VALID_TYPES.includes(r.rule_type)) {
        return NextResponse.json({ error: 'Invalid rule_type' }, { status: 400 });
      }
      const VALID_ADJ = ['pct_increase','pct_decrease','set_pct_of_base'];
      if (!VALID_ADJ.includes(r.price_adjustment?.type)) {
        return NextResponse.json({ error: 'Invalid price_adjustment.type' }, { status: 400 });
      }

      if (r.id) {
        // Update existing rule
        await db().query(
          `UPDATE pricing.dynamic_pricing_rules
           SET rule_type=$1, trigger_condition=$2, price_adjustment=$3,
               applies_to=$4, max_price_multiplier=$5, min_price_multiplier=$6,
               priority=$7, is_active=$8
           WHERE id=$9 AND event_id=$10 AND promoter_id=$11`,
          [
            r.rule_type,
            JSON.stringify(r.trigger_condition),
            JSON.stringify(r.price_adjustment),
            r.applies_to ?? 'all',
            r.max_price_multiplier ?? 2.00,
            r.min_price_multiplier ?? 0.50,
            r.priority ?? 1,
            r.is_active ?? true,
            r.id,
            params.id,
            ctx.promoterId,
          ],
        );
      } else {
        // Insert new rule
        await db().query(
          `INSERT INTO pricing.dynamic_pricing_rules
             (event_id, promoter_id, rule_type, trigger_condition, price_adjustment,
              applies_to, max_price_multiplier, min_price_multiplier, priority, is_active)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [
            params.id,
            ctx.promoterId,
            r.rule_type,
            JSON.stringify(r.trigger_condition),
            JSON.stringify(r.price_adjustment),
            r.applies_to ?? 'all',
            r.max_price_multiplier ?? 2.00,
            r.min_price_multiplier ?? 0.50,
            r.priority ?? 1,
            r.is_active ?? true,
          ],
        );
      }
    }

    return NextResponse.json({ ok: true });
  });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  return runAsPromoter(req, async (ctx) => {
    const ruleId = req.nextUrl.searchParams.get('rule_id');
    if (!ruleId) return NextResponse.json({ error: 'rule_id required' }, { status: 400 });

    await db().query(
      `DELETE FROM pricing.dynamic_pricing_rules
       WHERE id=$1 AND event_id=$2 AND promoter_id=$3`,
      [ruleId, params.id, ctx.promoterId],
    );
    return NextResponse.json({ ok: true });
  });
}
