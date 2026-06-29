/**
 * GET /api/carbon-offset-settings — vrátí aktivní carbon offset nastavení
 * (výše příplatku + label v jazyce)
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';

export async function GET(req: NextRequest): Promise<Response> {
  const locale = req.nextUrl.searchParams.get('locale') ?? 'cs';
  const client = await db().connect();
  try {
    const r = await client.query<{
      amount_halire: number;
      label_cs: string; label_sk: string; label_en: string;
      provider: string;
    }>(
      `SELECT amount_halire, label_cs, label_sk, label_en, provider
         FROM platform.carbon_offset_settings WHERE active=true ORDER BY id LIMIT 1`,
    );
    if (r.rowCount === 0) return NextResponse.json({ active: false });
    const row = r.rows[0];
    const label = locale === 'sk' ? row.label_sk : locale === 'en' ? row.label_en : row.label_cs;
    return NextResponse.json({
      active: true,
      amountHalire: row.amount_halire,
      label,
      provider: row.provider,
    });
  } finally {
    client.release();
  }
}
