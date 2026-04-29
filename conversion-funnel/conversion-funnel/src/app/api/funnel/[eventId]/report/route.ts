// GET /api/funnel/[eventId]/report?from=&to=&promoterId=
//
// Přístup omezen na promotéra akce.
// Query params: from (ISO date), to (ISO date), promoterId (UUID)

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getFunnelReport } from '@/services/funnel.service';

// ─── Stubs (v produkci injektovat přes DI / env) ────────────────────────────

const db = {
  async query<T>(_sql: string, _params?: unknown[]): Promise<T[]> {
    return [];
  },
  async execute(_sql: string, _params?: unknown[]): Promise<void> {},
};

const kafka = {
  async send(_topic: string, _payload: unknown): Promise<void> {},
};

// ─── Validace query params ───────────────────────────────────────────────────

const QuerySchema = z.object({
  from: z.string().datetime({ message: 'from musí být ISO 8601 datetime' }),
  to: z.string().datetime({ message: 'to musí být ISO 8601 datetime' }),
  promoterId: z.string().uuid({ message: 'promoterId musí být UUID' }),
});

// ─── Handler ─────────────────────────────────────────────────────────────────

export async function GET(
  req: NextRequest,
  { params }: { params: { eventId: string } },
): Promise<NextResponse> {
  const { eventId } = params;

  if (!eventId) {
    return NextResponse.json({ error: 'eventId is required' }, { status: 400 });
  }

  const { searchParams } = req.nextUrl;
  const parsed = QuerySchema.safeParse({
    from: searchParams.get('from'),
    to: searchParams.get('to'),
    promoterId: searchParams.get('promoterId'),
  });

  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.issues },
      { status: 422 },
    );
  }

  const { from, to, promoterId } = parsed.data;
  const fromDate = new Date(from);
  const toDate = new Date(to);

  if (fromDate >= toDate) {
    return NextResponse.json(
      { error: 'from musí být před to' },
      { status: 422 },
    );
  }

  try {
    const report = await getFunnelReport(
      { db, kafka },
      promoterId,
      eventId,
      fromDate,
      toDate,
    );

    return NextResponse.json(report, { status: 200 });
  } catch (err) {
    console.error('[funnel] getFunnelReport error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
