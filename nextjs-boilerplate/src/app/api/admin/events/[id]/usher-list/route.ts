/**
 * GET /api/admin/events/[id]/usher-list?format=json|csv|pdf — seznam pro uvaděče (kolo 8 / krok 8): platné vstupenky
 * termínu po místech — sál, řada, místo, kategorie, jméno, „ověřit průkaz" (ZTP/P, senior…). PDF k tisku (A4 na šířku).
 */
import { NextRequest, NextResponse } from 'next/server';
import { runAsActivePromoter } from '@/lib/admin-auth';
import { db } from '@/lib/db/rls-pool';
import { buildCsv } from '@/lib/reports/xlsx';
import { usherList } from '@/lib/theatre/reports';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }): Promise<Response> {
  const params = await props.params;
  return runAsActivePromoter(req, async (promoter) => {
    if (!/^[0-9a-f-]{36}$/i.test(params.id)) return NextResponse.json({ error: 'BAD_ID' }, { status: 422 });
    const list = await usherList(db(), promoter.promoterId, params.id);
    if (!list) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    const format = new URL(req.url).searchParams.get('format') ?? 'json';
    if (format === 'csv') {
      const csv = buildCsv(['Sál', 'Sekce', 'Řada', 'Místo', 'Kategorie', 'Jméno', 'Ověřit průkaz', 'Stav'],
        list.rows.map((r) => [r.hall, r.sector, r.row, r.seat, r.category ?? 'Plné', r.name, r.verifyId, r.ticketStatus === 'used' ? 'vstoupil' : '']));
      return new Response(csv, { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="uvadeci-${params.id.slice(0, 8)}.csv"` } });
    }
    if (format === 'pdf') {
      const { buildUsherPdf } = await import('@/lib/theatre/usher-pdf');
      const pdf = await buildUsherPdf(list, list.rows);
      return new Response(new Uint8Array(pdf), { headers: { 'content-type': 'application/pdf', 'content-disposition': `inline; filename="uvadeci-${params.id.slice(0, 8)}.pdf"` } });
    }
    return NextResponse.json(list);
  });
}
