import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsActivePromoter } from '@/lib/admin-auth';
import { z } from 'zod';

const patchSchema = z.object({
  status: z.enum(['ready', 'collected']),
});

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }): Promise<Response> {
  const params = await props.params;
  return runAsActivePromoter(req, async (promoter) => {
    if (!/^[0-9a-f-]{36}$/i.test(params.id)) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 422 });
    }

    const body: unknown = await req.json().catch(() => ({}));
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', issues: parsed.error.issues },
        { status: 422 },
      );
    }

    const r = await db().query(
      `UPDATE orders.foyer_orders fo
       SET status = $1
       WHERE fo.id = $2
         AND EXISTS (
           SELECT 1 FROM catalog.events e
           WHERE e.id = fo.event_id AND e.promoter_id = $3
         )
       RETURNING id`,
      [parsed.data.status, params.id, promoter.promoterId],
    );

    if (r.rows.length === 0) {
      return NextResponse.json({ error: 'Not found or access denied' }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  });
}
