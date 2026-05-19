import { NextResponse } from 'next/server';
import { Pool } from 'pg';
import { checkDatabaseHealth } from '@/lib/health-check/health.service';

let pool: Pool | null = null;
function getPool(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

/**
 * GET /api/health/db — DB readiness probe.
 * 200 ok / 503 unreachable. Pinges přes SELECT 1.
 */
export async function GET(): Promise<Response> {
  const client = await getPool().connect().catch(() => null);
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
