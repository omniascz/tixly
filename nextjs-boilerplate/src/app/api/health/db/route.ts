import { NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { checkDatabaseHealth } from '@/lib/health-check/health.service';
// Kolo 10: bez toho Next při buildu handler prerenderuje a čte DB (build padá / zapeče se stav z buildu).
export const dynamic = 'force-dynamic';

/**
 * GET /api/health/db — DB readiness probe.
 * 200 ok / 503 unreachable. Pinges přes SELECT 1.
 */
export async function GET(): Promise<Response> {
  const client = await db().connect().catch(() => null);
  if (!client) {
    return NextResponse.json(
      { status: 'error', responseTime: 0, error: 'Cannot connect to database' },
      { status: 503 },
    );
  }
  try {
    const health = await checkDatabaseHealth(client as unknown as Parameters<typeof checkDatabaseHealth>[0]);
    const statusCode = health.status === 'error' ? 503 : 200;
    return NextResponse.json(health, { status: statusCode });
  } finally {
    client.release();
  }
}
