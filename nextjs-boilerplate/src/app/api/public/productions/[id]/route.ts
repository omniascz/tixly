/**
 * GET /api/public/productions/[id] — veřejná stránka inscenace (kolo 8 / krok 1): karta + všechny budoucí
 * publikované termíny (město, sál, datum, obsazenost). Bez přihlášení, bez servisního kontextu — čtení
 * řídí veřejné politiky (publikované akce; inscenace s publikovaným termínem).
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { loadPublicProduction } from '@/lib/theatre/public-program';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }): Promise<Response> {
 const params = await props.params;
 if (!/^[0-9a-f-]{36}$/i.test(params.id)) return NextResponse.json({ error: 'BAD_ID' }, { status: 422 });
 const data = await loadPublicProduction(db(), params.id);
 if (!data) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
 return NextResponse.json(data);
}
