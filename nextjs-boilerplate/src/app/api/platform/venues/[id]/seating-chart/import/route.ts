/**
 * POST /api/platform/venues/[id]/seating-chart/import
 *
 * Body (JSON): { format: 'csv'|'svg'|'json'|'auto', name?: string, content: string, dryRun?: boolean }
 *
 * Volá parseCsv / parseSvg / parseJson z @/lib/seating/import-parsers, vrátí parsed layout
 * + summary (sectors/rows/seats). Když dryRun=false, uloží jako nový active chart (přes
 * stejnou logic jako POST /seating-chart).
 *
 * Limit: 200_000 seats. Promotér nemůže.
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsPlatformAdmin } from '@/lib/platform-auth';
import { z } from 'zod';
import { logAction, extractRequestContext } from '@/lib/audit/log';
import {
  parseCsv, parseJson, parseSvg, detectFormat,
  type ParseResult,
} from '@/lib/seating/import-parsers';
import { parseSmsTicketSvg, applySectorRenames } from '@/lib/seating/smsticket-parser';


const bodySchema = z.object({
  format: z.enum(['csv', 'svg', 'json', 'smsticket', 'auto']).default('auto'),
  filename: z.string().max(200).optional(),
  name: z.string().min(1).max(100).default('Imported'),
  content: z.string().min(1).max(20_000_000), // 20 MB
  dryRun: z.boolean().default(true),
  /** SmsTicket: rename detected color sectors to human-readable names. */
  sectorRenames: z.record(z.string(), z.string().min(1).max(100)).optional(),
});

interface RowSample {
  label: string;
  seatCount: number;
  firstNum: string | null;
  lastNum: string | null;
  /** "ellipsis" indikátor — UI ho vykreslí jako "…" mezi prvními a posledními řadami. */
  ellipsis?: boolean;
}

function sampleRows(rows: ParseResult['layout']['sectors'][number]['rows']): RowSample[] {
  const toSample = (r: ParseResult['layout']['sectors'][number]['rows'][number]): RowSample => ({
    label: r.label,
    seatCount: r.seats.length,
    firstNum: r.seats[0]?.num ?? null,
    lastNum: r.seats[r.seats.length - 1]?.num ?? null,
  });
  if (rows.length <= 5) return rows.map(toSample);
  return [
    ...rows.slice(0, 3).map(toSample),
    { label: '…', seatCount: 0, firstNum: null, lastNum: null, ellipsis: true },
    ...rows.slice(-2).map(toSample),
  ];
}

function summarize(result: ParseResult): {
  sectors: number;
  rows: number;
  seats: number;
  bySector: { name: string; rows: number; seats: number }[];
} {
  let totalRows = 0;
  let totalSeats = 0;
  const bySector: { name: string; rows: number; seats: number }[] = [];
  for (const s of result.layout.sectors) {
    let secSeats = 0;
    for (const r of s.rows) secSeats += r.seats.length;
    totalRows += s.rows.length;
    totalSeats += secSeats;
    bySector.push({ name: s.name, rows: s.rows.length, seats: secSeats });
  }
  return { sectors: result.layout.sectors.length, rows: totalRows, seats: totalSeats, bySector };
}

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }): Promise<Response> {
  const params = await props.params;
  return runAsPlatformAdmin(req, async (admin) => {
  const body: unknown = await req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.issues },
      { status: 422 },
    );
  }
  const { content, name, dryRun } = parsed.data;
  let format = parsed.data.format;
  if (format === 'auto') {
    const detected = detectFormat(content, parsed.data.filename);
    if (!detected) {
      return NextResponse.json(
        { error: 'Cannot detect format. Set format: csv|svg|json explicitly.' },
        { status: 422 },
      );
    }
    format = detected;
  }

  let result: ParseResult;
  let backgroundUrl: string | undefined;
  try {
    if (format === 'csv') result = parseCsv(content);
    else if (format === 'svg') result = parseSvg(content);
    else if (format === 'smsticket') {
      const r = parseSmsTicketSvg(content);
      backgroundUrl = r.backgroundUrl;
      result = { layout: r.layout, warnings: r.warnings };
    } else result = parseJson(content);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message, format }, { status: 422 });
  }

  // Apply sector renames (typically used with smsticket — color → human name).
  if (parsed.data.sectorRenames && Object.keys(parsed.data.sectorRenames).length > 0) {
    result = {
      layout: applySectorRenames(result.layout, parsed.data.sectorRenames),
      warnings: result.warnings,
    };
  }

  const summary = summarize(result);
  if (summary.seats > 200_000) {
    return NextResponse.json(
      { error: 'TOO_MANY_SEATS', max: 200_000, found: summary.seats },
      { status: 422 },
    );
  }
  if (summary.seats === 0) {
    return NextResponse.json({ error: 'No seats parsed', warnings: result.warnings }, { status: 422 });
  }

  if (dryRun) {
    return NextResponse.json({
      dryRun: true,
      format,
      summary,
      warnings: result.warnings,
      backgroundUrl,
      layoutPreview: {
        viewBox: result.layout.viewBox,
        sectors: result.layout.sectors.map((s) => ({
          name: s.name,
          color: s.color,
          rowCount: s.rows.length,
          // Sample řad: prvních 3 + poslední 2 pokud je víc jak 5, jinak všechny.
          // Každá řada má label, count a rozsah čísel sedadel (např. "1–22").
          rows: sampleRows(s.rows),
          rowsTruncated: s.rows.length > 5,
        })),
      },
    });
  }

  // Persist
  const client = await db().connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE catalog.venue_seating_charts SET active = false WHERE venue_id = $1`,
      [params.id],
    );
    const r = await client.query<{ id: string }>(
      `INSERT INTO catalog.venue_seating_charts
         (venue_id, name, layout, total_seats, active, created_by_user_id, source, notes)
       VALUES ($1, $2, $3::jsonb, $4, true, $5, $6, $7)
       RETURNING id`,
      [
        params.id, name, JSON.stringify(result.layout), summary.seats,
        admin.userId, format, result.warnings.length ? `Imported with ${result.warnings.length} warning(s)` : null,
      ],
    );
    // Auto-update venue.capacity podle chartu + (volitelně) floor plan z smsticket pozadí.
    if (backgroundUrl) {
      await client.query(
        `UPDATE catalog.venues
            SET capacity = $1,
                floor_plan_url = COALESCE(floor_plan_url, $2),
                last_modified_by_user_id = $3,
                last_modified_at = NOW()
          WHERE id = $4`,
        [summary.seats, backgroundUrl, admin.userId, params.id],
      );
    } else {
      await client.query(
        `UPDATE catalog.venues
            SET capacity = $1,
                last_modified_by_user_id = $2,
                last_modified_at = NOW()
          WHERE id = $3`,
        [summary.seats, admin.userId, params.id],
      );
    }
    await client.query('COMMIT');

    const reqCtx = extractRequestContext(req);
    void logAction({
      actorUserId: admin.userId,
      actorRole: 'platform_admin',
      action: 'venue.seating_chart.import',
      targetType: 'venue',
      targetId: params.id,
      metadata: { chartId: r.rows[0].id, format, name, ...summary, warnings: result.warnings },
      ip: reqCtx.ip,
      userAgent: reqCtx.userAgent,
    });

    return NextResponse.json(
      { id: r.rows[0].id, format, summary, warnings: result.warnings },
      { status: 201 },
    );
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[seating-chart import]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  } finally {
    client.release();
  }

  });
}
