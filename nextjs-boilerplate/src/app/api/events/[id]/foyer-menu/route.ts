import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 422 });
  }

  const r = await db().query<{
    id: string;
    name: string;
    description: string | null;
    price_halire: number;
    category: string;
    available_count: number | null;
    image_url: string | null;
    order_index: number;
  }>(
    `SELECT id, name, description, price_halire, category,
            available_count, image_url, order_index
     FROM catalog.foyer_menu_items
     WHERE event_id = $1 AND is_active = true
     ORDER BY category, order_index`,
    [params.id],
  );

  return NextResponse.json({
    items: r.rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      priceHalire: row.price_halire,
      category: row.category,
      availableCount: row.available_count,
      imageUrl: row.image_url,
      orderIndex: row.order_index,
    })),
  });
}
