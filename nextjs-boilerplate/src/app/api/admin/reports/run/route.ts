/**
 * GET /api/admin/reports/run?reportId=X&dateFrom=YYYY-MM-DD&dateTo=YYYY-MM-DD&...
 *
 * Spustí jeden report z registru a vrátí výsledek.
 * Platforma-scope reporty vyžadují is_platform_admin.
 * Promotér-scope reporty jsou omezeny na vlastního promotéra.
 *
 * ?format=csv  → vrátí text/csv ke stažení
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsPromoter } from '@/lib/admin-auth';
import { REPORT_BY_ID, DISABLED_REPORTS } from '@/lib/reports/registry';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f-]{36}$/i;
const MONTH_RE = /^\d{4}-\d{2}$/;

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export async function GET(req: NextRequest): Promise<Response> {
  return runAsPromoter(req, async (promoter) => {
    const sp = req.nextUrl.searchParams;
    const reportId = sp.get('reportId') ?? '';
    const format = sp.get('format') ?? 'json';

    const def = REPORT_BY_ID.get(reportId);
    if (!def) {
      // Vyrazeny report (R-35) dostane VLASTNI odpoved, at je z ni poznat, ze
      // to neni preklep v id, ale ceka se na tabulku. Bez toho by uzivatel
      // videl bud 404 'neznamy report', nebo (driv) syrove 42P01 z databaze.
      const chybi = DISABLED_REPORTS.get(reportId);
      if (chybi) {
        return NextResponse.json({
          error: 'REPORT_UNAVAILABLE',
          message: `Report je dočasně nedostupný — chybí tabulka ${chybi}.`,
          missingTable: chybi,
        }, { status: 503 });
      }
      return NextResponse.json({ error: 'UNKNOWN_REPORT' }, { status: 404 });
    }

    if (def.scope === 'platform') {
      const adminCheck = await db().query<{ is_platform_admin: boolean }>(
        `SELECT is_platform_admin FROM identity.users WHERE id = $1`,
        [promoter.userId],
      );
      if (!adminCheck.rows[0]?.is_platform_admin) {
        return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
      }
    }

    // Build params map from query string, validate each
    const params: Record<string, string> = {};
    for (const p of def.params) {
      const val = sp.get(p.key);
      if (!val) {
        if (p.required) {
          return NextResponse.json({ error: `MISSING_PARAM:${p.key}` }, { status: 422 });
        }
        continue;
      }
      if (p.type === 'date' && !DATE_RE.test(val)) {
        return NextResponse.json({ error: `INVALID_DATE:${p.key}` }, { status: 422 });
      }
      if (p.type === 'uuid' && !UUID_RE.test(val)) {
        return NextResponse.json({ error: `INVALID_UUID:${p.key}` }, { status: 422 });
      }
      if (p.type === 'month' && !MONTH_RE.test(val)) {
        return NextResponse.json({ error: `INVALID_MONTH:${p.key}` }, { status: 422 });
      }
      if (p.type === 'select' && p.options) {
        if (!p.options.some((o) => o.value === val)) {
          return NextResponse.json({ error: `INVALID_SELECT:${p.key}` }, { status: 422 });
        }
      }
      params[p.key] = val;
    }

    const promoterId = promoter.promoterId ?? '';
    const t0 = Date.now();

    let result: { rows: Record<string, unknown>[] };
    try {
      const { sql, values } = def.buildQuery(promoterId, params);
      result = await db().query<Record<string, unknown>>(sql, values);
    } catch (err) {
      console.error('[reports/run] SQL error', reportId, err);
      return NextResponse.json({ error: 'QUERY_ERROR' }, { status: 500 });
    }

    const execMs = Date.now() - t0;
    const rows = result.rows;
    const truncated = rows.length >= 5000;

    if (format === 'csv') {
      const cols = def.columns.map((c) => c.key);
      const header = def.columns.map((c) => csvEscape(c.label)).join(',');
      const lines = rows.map((r) => cols.map((k) => csvEscape(r[k])).join(','));
      const csv = [header, ...lines].join('\r\n');
      return new Response(csv, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="tixly-${reportId}.csv"`,
        },
      });
    }

    return NextResponse.json({
      reportId,
      title: def.title,
      columns: def.columns,
      rows,
      rowCount: rows.length,
      truncated,
      execMs,
    });
  });
}
