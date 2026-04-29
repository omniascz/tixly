/**
 * GET /api/events/[id]/recommendations
 *
 * Public — vrátí 6 doporučených events na základě co-occurrence + content fallback.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getRecommendations } from '@/lib/recommendations/engine';

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 422 });
  }
  const recs = await getRecommendations(params.id, 6);
  return NextResponse.json({ recommendations: recs });
}
