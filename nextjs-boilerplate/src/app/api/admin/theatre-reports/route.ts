/**
 * GET /api/admin/theatre-reports — reporty za termín / inscenaci / období (kolo 8 / krok 8).
 *   ?scope=term&eventId=… | ?scope=production&productionId=… | ?scope=period&from=YYYY-MM-DD&to=YYYY-MM-DD
 *   &format=json (výchozí) | csv | xlsx
 * Prodáno a tržby podle zóny, kategorie a kanálu (online, pokladna, rezervace, firemní, volné), obsazenost v %,
 * využití blokací, propadlé rezervace. CSV = prodeje (středník, BOM); XLSX = listy Prodej, Obsazenost, Blokace, Rezervace.
 */
import { NextRequest, NextResponse } from 'next/server';
import { runAsActivePromoter } from '@/lib/admin-auth';
import { db } from '@/lib/db/rls-pool';
import { buildCsv, buildXlsx } from '@/lib/reports/xlsx';
import { CHANNEL_LABEL, theatreReport, type Scope } from '@/lib/theatre/reports';

export const dynamic = 'force-dynamic';
const UUID = /^[0-9a-f-]{36}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const kc = (m: number): number => Math.round(m) / 100;

export async function GET(req: NextRequest): Promise<Response> {
  return runAsActivePromoter(req, async (promoter) => {
    const sp = new URL(req.url).searchParams;
    const kind = sp.get('scope');
    let scope: Scope;
    if (kind === 'term' && UUID.test(sp.get('eventId') ?? '')) scope = { kind, eventId: sp.get('eventId')! };
    else if (kind === 'production' && UUID.test(sp.get('productionId') ?? '')) scope = { kind, productionId: sp.get('productionId')! };
    else if (kind === 'period' && DAY.test(sp.get('from') ?? '') && DAY.test(sp.get('to') ?? '')) scope = { kind, from: sp.get('from')!, to: sp.get('to')! };
    else return NextResponse.json({ error: 'BAD_SCOPE', message: 'scope=term&eventId | scope=production&productionId | scope=period&from&to' }, { status: 422 });

    const r = await theatreReport(db(), promoter.promoterId, scope);
    const format = sp.get('format') ?? 'json';
    const salesHeader = ['Termín', 'Datum', 'Zóna', 'Kategorie', 'Kanál', 'Prodáno', 'Tržba (Kč)'];
    const salesRows = r.sales.map((s) => [s.title, s.dateStart.slice(0, 16), s.zone, s.category, CHANNEL_LABEL[s.channel] ?? s.channel, s.sold, kc(s.revenueMinor)]);
    const name = `report-${kind}-${new Date().toISOString().slice(0, 10)}`;
    if (format === 'csv') {
      return new Response(buildCsv(salesHeader, salesRows), {
        headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${name}.csv"` },
      });
    }
    if (format === 'xlsx') {
      const buf = buildXlsx([
        { name: 'Prodej', header: salesHeader, rows: salesRows },
        {
          name: 'Obsazenost', header: ['Termín', 'Datum', 'Město', 'Sál', 'Prodejná místa', 'Prodáno', 'Rezervováno', 'Blokováno', 'Obsazenost %'],
          rows: r.occupancy.map((o) => [o.title, o.dateStart.slice(0, 16), o.city, o.hall, o.sellable, o.sold, o.reserved, o.blocked, o.occupiedPct]),
        },
        {
          name: 'Blokace', header: ['Termín', 'Blokace', 'Míst celkem', 'Uvolněno', 'Vydáno', 'Prodáno', 'Zbývá'],
          rows: r.blocks.map((b) => [b.title, b.block, b.total, b.released, b.issued, b.sold, b.remaining]),
        },
        {
          name: 'Rezervace', header: ['Termín', 'Aktivní', 'Zaplacené', 'Propadlé', 'Zrušené', 'Propadlá místa'],
          rows: r.reservations.map((x) => [x.title, x.active, x.paid, x.expired, x.cancelled, x.expiredSeats]),
        },
      ]);
      return new Response(new Uint8Array(buf), {
        headers: {
          'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'content-disposition': `attachment; filename="${name}.xlsx"`,
        },
      });
    }
    // u termínu i inscenace, ke které patří (UI nabídne report celé inscenace)
    const productionId = scope.kind === 'term'
      ? (await db().query<{ production_id: string | null }>(`SELECT production_id FROM catalog.events WHERE id = $1 AND promoter_id = $2`, [scope.eventId, promoter.promoterId])).rows[0]?.production_id ?? null
      : null;
    return NextResponse.json({ ...r, productionId });
  });
}
