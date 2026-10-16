/**
 * GET /api/admin/ares/[ico] — údaje firmy z ARES pro firemní objednávku (kolo 8 / krok 6): název, sídlo, DIČ, aktivita.
 * Sdílený klient lib/compliance/ares (ARES_BASE_URL, timeout); výpadek ARES = 503 „vyplňte ručně", ne chyba objednávky.
 */
import { NextRequest, NextResponse } from 'next/server';
import { runAsActivePromoter } from '@/lib/admin-auth';
import { checkAres } from '@/lib/compliance/ares';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, props: { params: Promise<{ ico: string }> }): Promise<Response> {
  const params = await props.params;
  return runAsActivePromoter(req, async () => {
    if (!/^\d{1,8}$/.test(params.ico)) return NextResponse.json({ error: 'INVALID_ICO' }, { status: 422 });
    const r = await checkAres(params.ico);
    if (r.outcome === 'unavailable') {
      return NextResponse.json({ error: 'ARES_UNAVAILABLE', message: 'ARES teď neodpovídá — údaje vyplňte ručně.' }, { status: 503 });
    }
    if (!r.valid) return NextResponse.json({ error: r.outcome === 'not_found' ? 'NOT_FOUND' : 'INVALID_ICO' }, { status: r.outcome === 'not_found' ? 404 : 422 });
    return NextResponse.json({
      ico: params.ico.padStart(8, '0'), name: r.legalName ?? null, address: r.address ?? null, dic: r.dic ?? null, active: r.active,
    });
  });
}
