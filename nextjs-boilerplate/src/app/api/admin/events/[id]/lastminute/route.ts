import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsPromoter, runAsActivePromoter } from '@/lib/admin-auth';
import { z } from 'zod';

interface LastminuteRuleRow {
  id: string;
  event_id: string;
  hours_before: number;
  min_occupancy_pct: number;
  discount_pct: number;
  is_active: boolean;
  triggered_at: string | null;
  created_at: string;
  updated_at: string;
}

async function ownsEvent(eventId: string, promoterId: string): Promise<boolean> {
  const r = await db().query(
    `SELECT 1 FROM catalog.events WHERE id = $1 AND promoter_id = $2`,
    [eventId, promoterId],
  );
  return r.rows.length > 0;
}

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }): Promise<Response> {
  const params = await props.params;
  return runAsPromoter(req, async (promoter) => {
    if (!(await ownsEvent(params.id, promoter.promoterId))) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const r = await db().query<LastminuteRuleRow>(
      `SELECT id, event_id, hours_before, min_occupancy_pct, discount_pct,
              is_active, triggered_at, created_at, created_at AS updated_at
       FROM catalog.lastminute_rules
       WHERE event_id = $1`,
      [params.id],
    );

    return NextResponse.json({ rule: r.rows[0] ?? null });
  });
}

const createSchema = z.object({
  hoursBefore: z.number().int().min(1).max(72).default(2),
  minOccupancyPct: z.number().int().min(1).max(99).default(60),
  discountPct: z.number().int().min(5).max(70).default(30),
  isActive: z.boolean().default(true),
});

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }): Promise<Response> {
  const params = await props.params;
  return runAsActivePromoter(req, async (promoter) => {
    const body: unknown = await req.json().catch(() => ({}));
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', issues: parsed.error.issues },
        { status: 422 },
      );
    }

    if (!(await ownsEvent(params.id, promoter.promoterId))) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const { hoursBefore, minOccupancyPct, discountPct, isActive } = parsed.data;

    const r = await db().query<{ id: string }>(
      // `catalog.lastminute_rules` NEMÁ sloupec `promoter_id` — vazba na
      // promotéra vede přes `event_id` → catalog.events.promoter_id.
      // Není to přejmenování, sloupec tam prostě není. PŘED: 42703 → 500 při
      // každém uložení pravidla. Ověřeno reálným během proti klonu.
      `INSERT INTO catalog.lastminute_rules
         (event_id, hours_before, min_occupancy_pct, discount_pct, is_active)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (event_id) DO UPDATE
         SET hours_before      = EXCLUDED.hours_before,
             min_occupancy_pct = EXCLUDED.min_occupancy_pct,
             discount_pct      = EXCLUDED.discount_pct,
             is_active         = EXCLUDED.is_active,
             triggered_at      = NULL
       RETURNING id`,
      [params.id, hoursBefore, minOccupancyPct, discountPct, isActive],
    );

    return NextResponse.json({ id: r.rows[0].id }, { status: 201 });
  });
}

const patchSchema = z.object({
  isActive: z.boolean(),
});

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }): Promise<Response> {
  const params = await props.params;
  return runAsActivePromoter(req, async (promoter) => {
    const body: unknown = await req.json().catch(() => ({}));
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', issues: parsed.error.issues },
        { status: 422 },
      );
    }

    if (!(await ownsEvent(params.id, promoter.promoterId))) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const r = await db().query<{ id: string }>(
      `UPDATE catalog.lastminute_rules
       SET is_active = $1
       WHERE event_id = $2 AND promoter_id = $3
       RETURNING id`,
      [parsed.data.isActive, params.id, promoter.promoterId],
    );

    if (r.rows.length === 0) {
      return NextResponse.json({ error: 'Rule not found' }, { status: 404 });
    }

    return NextResponse.json({ id: r.rows[0].id });
  });
}

export async function DELETE(req: NextRequest, props: { params: Promise<{ id: string }> }): Promise<Response> {
  const params = await props.params;
  return runAsActivePromoter(req, async (promoter) => {
    if (!(await ownsEvent(params.id, promoter.promoterId))) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    await db().query(
      `DELETE FROM catalog.lastminute_rules
       WHERE event_id = $1 AND promoter_id = $2`,
      [params.id, promoter.promoterId],
    );

    return new NextResponse(null, { status: 204 });
  });
}
