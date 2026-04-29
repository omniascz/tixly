import { NextResponse } from 'next/server';
import { checkDatabaseHealth } from '@/lib/health-check/health.service';

/**
 * GET /api/health/db
 *
 * Database-only health check endpoint
 * Fast endpoint for simple database connectivity verification
 * Target response time: < 200ms
 *
 * @returns Database health status with response time
 */
export async function GET() {
  try {
    // In production, you would initialize and pass the actual database client:
    // const db = getDatabase(); // your db initialization
    // const health = await checkDatabaseHealth(db);

    // For now, return error state (no client initialized)
    const health = await checkDatabaseHealth(undefined);

    const statusCode = health.status === 'ok' ? 200 : health.status === 'slow' ? 200 : 503;

    return NextResponse.json(health, { status: statusCode });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Database check failed';

    return NextResponse.json(
      {
        status: 'error',
        responseTime: 0,
        error: errorMessage,
      },
      { status: 503 },
    );
  }
}
