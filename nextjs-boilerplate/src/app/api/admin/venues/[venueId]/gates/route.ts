/**
 * GET  /api/admin/venues/[venueId]/gates  — list bran pro venue
 * POST /api/admin/venues/[venueId]/gates  — create brána
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db/rls-pool';
import { runAsActivePromoter } from '@/lib/admin-auth';

const createSchema = z.object({
  code:          z.string().min(1).max(20),
  label:         z.string().min(1).max(120),
  description:   z.string().max(500).optional(),
  isAccessible:  z.boolean().default(false),
  sortOrder:     z.number().int().min(0).default(0),
});

interface GateRow {
  id: string;
  venue_id: string;
  code: string;
  label: string;
  description: string | null;
  is_accessible: boolean;
  sort_order: number;
  created_at: string;
}

export async function GET(req: NextRequest, props: { params: Promise<{ venueId: string }> }): Promise<Response> {
  const params = await props.params;
  return runAsActivePromoter(req, async (promoter) => {
    const venueCheck = await db().query(
      `SELECT id FROM catalog.venues WHERE id = $1 AND promoter_id = $2`,
      [params.venueId, promoter.promoterId],
    );
    if (!venueCheck.rows[0]) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const rows = await db().query<GateRow>(
      `SELECT id, venue_id, code, label, description, is_accessible, sort_order, created_at
         FROM catalog.venue_gates
        WHERE venue_id = $1
        ORDER BY sort_order, code`,
      [params.venueId],
    );

    return NextResponse.json({ gates: rows.rows });
  });
}

export async function POST(req: NextRequest, props: { params: Promise<{ venueId: string }> }): Promise<Response> {
  const params = await props.params;
  return runAsActivePromoter(req, async (promoter) => {
    const venueCheck = await db().query(
      `SELECT id FROM catalog.venues WHERE id = $1 AND promoter_id = $2`,
      [params.venueId, promoter.promoterId],
    );
    if (!venueCheck.rows[0]) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const body: unknown = await req.json().catch(() => ({}));
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'INVALID_INPUT', issues: parsed.error.issues }, { status: 422 });
    }
    const d = parsed.data;

    try {
      const ins = await db().query<GateRow>(
        `INSERT INTO catalog.venue_gates (venue_id, code, label, description, is_accessible, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [params.venueId, d.code, d.label, d.description ?? null, d.isAccessible, d.sortOrder],
      );
      return NextResponse.json({ gate: ins.rows[0] }, { status: 201 });
    } catch (e: unknown) {
      if ((e as { code?: string }).code === '23505') {
        return NextResponse.json({ error: 'DUPLICATE_CODE', message: `Kód "${d.code}" již existuje.` }, { status: 409 });
      }
      throw e;
    }
  });
}
