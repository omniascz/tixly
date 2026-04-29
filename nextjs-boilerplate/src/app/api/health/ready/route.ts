import { NextResponse } from 'next/server';

// Readiness probe — ověří připojení k DB a Redis.
// Vrací 200 OK pouze pokud jsou obě služby dostupné.
// Používá se v CI před spuštěním integračních testů.
export async function GET() {
  const checks: Record<string, string> = {};

  // DB check
  try {
    const { Client } = await import('pg');
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    await client.query('SELECT 1');
    await client.end();
    checks.database = 'ok';
  } catch {
    checks.database = 'error';
  }

  // Redis check
  try {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const { createClient } = await import('redis');
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    const redis = createClient({ url: process.env.REDIS_URL });
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
    await redis.connect();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
    await redis.ping();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
    await redis.disconnect();
    checks.redis = 'ok';
  } catch {
    checks.redis = 'error';
  }

  const allOk = Object.values(checks).every((v) => v === 'ok');

  const statusCode = allOk ? 200 : 503;
  const responseStatus = allOk ? 'ok' : 'degraded';

  return NextResponse.json(
    { status: responseStatus, checks },
    { status: statusCode },
  );
}
