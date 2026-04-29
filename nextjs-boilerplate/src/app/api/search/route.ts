/**
 * GET /api/search?q=...&limit=20
 *
 * Public natural language search.
 */

import { NextRequest, NextResponse } from 'next/server';
import { semanticSearch } from '@/lib/ai/semantic-search';

export async function GET(req: NextRequest): Promise<Response> {
  const q = req.nextUrl.searchParams.get('q');
  if (!q || q.length < 2) {
    return NextResponse.json({ error: 'q required (min 2 chars)' }, { status: 422 });
  }
  const limit = Math.min(50, Number(req.nextUrl.searchParams.get('limit') ?? 20));
  const result = await semanticSearch({ raw: q }, limit);
  return NextResponse.json(result);
}
