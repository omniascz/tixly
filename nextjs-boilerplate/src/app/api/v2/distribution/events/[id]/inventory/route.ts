import { NextRequest, NextResponse } from 'next/server';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';
import { verifyDistributionToken } from '@/lib/distribution/auth';

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }): Promise<Response> {
  const params = await props.params;
  // Kolo 2 / 3B: partner ověřen tokenem; distribution_* pod RLS jen svc/admin
  return runWithServiceContext(async () => {
  const ctx = await verifyDistributionToken(req);
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const eventCheck = await db().query<{ id: string }>(
    `SELECT id FROM catalog.events WHERE id = $1 AND status = 'published'`,
    [params.id],
  );
  if (eventCheck.rows.length === 0) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }

  const r = await db().query<{
    id: string;
    name: string;
    base_price: number;
    total_qty: number;
    remaining_qty: number;
  }>(
    `SELECT id, name, base_price, total_qty, remaining_qty
     FROM catalog.ticket_types
     WHERE event_id = $1 AND visibility = 'public'
     ORDER BY base_price ASC`,
    [params.id],
  );

  const ticket_types = r.rows.map((tt) => ({
    id: tt.id,
    name: tt.name,
    price_halire: tt.base_price,
    available: Math.max(0, (tt.remaining_qty ?? 0)),
    total: tt.total_qty ?? 0,
  }));

  return NextResponse.json({ ticket_types });
  });
}
