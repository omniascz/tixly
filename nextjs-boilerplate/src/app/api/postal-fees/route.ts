/**
 * GET /api/postal-fees — dostupné poštovní sazby per country
 */
import { NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';

export async function GET(): Promise<Response> {
  const client = await db().connect();
  try {
    const r = await client.query(
      `SELECT country, fee_halire, carrier FROM platform.postal_fees WHERE active = true ORDER BY country`,
    );
    return NextResponse.json({ fees: r.rows });
  } catch {
    return NextResponse.json({ fees: [] });
  } finally {
    client.release();
  }
}
