/**
 * GET /api/sellers?city=Praha&country=CZ&q=keyword&type=kiosk
 *
 * Veřejný locator fyzických prodejních míst vstupenek Tixly.
 * Vrátí reseller partnery s public_listing=true a status='active'.
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';

export const dynamic = 'force-dynamic';

export interface SellerLocation {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  country: string;
  location_type: string;
  opening_hours: string | null;
  website: string | null;
  logo_url: string | null;
  lat: number | null;
  lng: number | null;
}

export async function GET(req: NextRequest): Promise<Response> {
  const url = req.nextUrl;
  const country = (url.searchParams.get('country') ?? 'CZ').toUpperCase().slice(0, 2);
  const city = url.searchParams.get('city')?.trim();
  const q = url.searchParams.get('q')?.trim();
  const type = url.searchParams.get('type')?.trim();

  const conditions: string[] = [
    `public_listing = true`,
    `status = 'active'`,
    `country = $1`,
  ];
  const params: (string | null)[] = [country];
  let p = 2;

  if (city) {
    conditions.push(`city ILIKE $${p++}`);
    params.push(`%${city}%`);
  }
  if (q) {
    conditions.push(`(name ILIKE $${p} OR address ILIKE $${p++})`);
    params.push(`%${q}%`);
  }
  if (type) {
    conditions.push(`location_type = $${p++}`);
    params.push(type);
  }

  const r = await db().query<SellerLocation>(
    `SELECT id, name, address, city, country, location_type,
            opening_hours, website, logo_url,
            lat::float, lng::float
     FROM platform.reseller_partners
     WHERE ${conditions.join(' AND ')}
     ORDER BY city ASC, name ASC
     LIMIT 200`,
    params,
  );

  // Seskupit po městech pro přehlednost
  const byCity: Record<string, SellerLocation[]> = {};
  for (const row of r.rows) {
    const c = row.city ?? 'Ostatní';
    (byCity[c] ??= []).push(row);
  }

  return NextResponse.json({
    sellers: r.rows,
    byCity,
    total: r.rowCount,
  });
}
