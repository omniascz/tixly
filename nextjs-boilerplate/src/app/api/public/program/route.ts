/**
 * GET /api/public/program?city=&month=YYYY-MM&promoterId= — program podle měst (kolo 8 / krok 1).
 * Budoucí publikované termíny seskupené podle města; filtr podle města a měsíce.
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { loadProgram } from '@/lib/theatre/public-program';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<Response> {
  const sp = req.nextUrl.searchParams;
  const month = sp.get('month');
  if (month && !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return NextResponse.json({ error: 'BAD_MONTH' }, { status: 422 });
  const promoterId = sp.get('promoterId');
  if (promoterId && !/^[0-9a-f-]{36}$/i.test(promoterId)) return NextResponse.json({ error: 'BAD_PROMOTER' }, { status: 422 });
  const cities = await loadProgram(db(), { city: sp.get('city'), month, promoterId });
  return NextResponse.json({ cities });
}
