/**
 * GET /api/events/[id]/addons — public list dostupných add-ons
 *
 * Žádný auth — kupec při checkout.
 */

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

interface AddonRow {
  id: string;
  name: string;
  description: string | null;
  category: string;
  price_halire: number;
  max_quantity: number;
  stock_available: number | null;
  image_url: string | null;
  display_order: number;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) {
    return NextResponse.json({ addons: [] });
  }
  const r = await db().query<AddonRow>(
    `SELECT id, name, description, category, price_halire, max_quantity,
            stock_available, image_url, display_order
     FROM public.checkout_addons
     WHERE event_id = $1 AND available = TRUE
     ORDER BY display_order, name`,
    [params.id],
  );
  return NextResponse.json({
    addons: r.rows.map((a) => ({
      id: a.id,
      name: a.name,
      description: a.description,
      category: a.category,
      priceHalire: a.price_halire,
      maxQuantity: a.max_quantity,
      stockAvailable: a.stock_available,
      imageUrl: a.image_url,
    })),
  });
}
