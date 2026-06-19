import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsActivePromoter } from '@/lib/admin-auth';
import { z } from 'zod';

const patchSchema = z.object({
  status: z.enum(['pending', 'confirmed', 'paid', 'cancelled']).optional(),
  notes: z.string().max(1000).optional(),
  unitPriceHalire: z.number().int().min(0).optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return runAsActivePromoter(req, async (promoter) => {
    const { id } = await params;
    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      return NextResponse.json({ error: 'INVALID_ID' }, { status: 422 });
    }

    const body: unknown = await req.json().catch(() => ({}));
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'INVALID_BODY', issues: parsed.error.issues }, { status: 422 });
    }
    if (!parsed.data.status && parsed.data.notes === undefined && parsed.data.unitPriceHalire === undefined) {
      return NextResponse.json({ error: 'NOTHING_TO_UPDATE' }, { status: 422 });
    }

    const sets: string[] = ['updated_at = NOW()'];
    const args: unknown[] = [id, promoter.promoterId];
    let idx = 3;

    if (parsed.data.status !== undefined) {
      sets.push(`status = $${idx++}`);
      args.push(parsed.data.status);
    }
    if (parsed.data.notes !== undefined) {
      sets.push(`notes = $${idx++}`);
      args.push(parsed.data.notes);
    }
    if (parsed.data.unitPriceHalire !== undefined) {
      sets.push(`unit_price_halire = $${idx}`);
      sets.push(`total_price_halire = $${idx} * student_count`);
      idx++;
      args.push(parsed.data.unitPriceHalire);
    }

    const r = await db().query<{
      id: string;
      status: string;
      contact_email: string;
      school_name: string;
      student_count: number;
    }>(
      `UPDATE orders.school_bookings
          SET ${sets.join(', ')}
        WHERE id = $1 AND promoter_id = $2
        RETURNING id, status, contact_email, school_name, student_count`,
      args,
    );

    if (r.rows.length === 0) {
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    }

    const row = r.rows[0];

    if (parsed.data.status === 'confirmed') {
      console.log(
        `[school-bookings] CONFIRMED booking ${row.id} for school=${row.school_name} ` +
        `students=${row.student_count} → send invoice to ${row.contact_email}`,
      );
    }

    return NextResponse.json({ ok: true, booking: row });
  });
}
