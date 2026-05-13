import { NextRequest, NextResponse } from 'next/server';
import { processAbandonedCarts } from '../../../../services/abandonment.service.js';

const deps = {
  db: null as any,
  email: { send: async () => {} },
  kafka: { send: async () => {} },
};

// POST /api/cron/cart-abandonment
// Volá Vercel Cron každých 5 minut (viz vercel.json).
// Chráněno CRON_SECRET — bez něj vrátí 401.
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const result = await processAbandonedCarts(new Date(), deps);
  return NextResponse.json(result, { status: 200 });
}
