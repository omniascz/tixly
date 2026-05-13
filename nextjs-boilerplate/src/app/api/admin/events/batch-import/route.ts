/**
 * POST /api/admin/events/batch-import
 *
 * Hromadné vytvoření představení z CSV. Promotér pošle JSON pole row objektů,
 * server provede validaci + insert v jedné transakci.
 *
 * CSV sloupce (oddělovač `;`, UTF-8):
 *   title;date_start;venue_id;category;ticket_type_name;ticket_price_czk;
 *   total_qty;zone;is_seated;description
 *
 * Klient může zaslat dry_run=true → vrátí jen validaci, nic nevloží.
 *
 * Pro každý event:
 *   - 1× catalog.events (status='draft' default; promotér ho potom publishne ručně
 *     v `/admin/events` nebo přes UI batch publishe)
 *   - 1× catalog.ticket_types
 *   - pokud is_seated && zone existuje → spustí copy-layout-to-event-seats
 *
 * Limit: 200 řádků per request (DOS protection).
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { Pool } from 'pg';
import { requirePromoter } from '@/lib/admin-auth';
import { copyLayoutToEventSeats } from '@/lib/seats/copy-layout-to-event-seats';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

const rowSchema = z.object({
  title: z.string().min(3).max(200),
  dateStart: z.string().datetime(),
  venueId: z.string().uuid(),
  category: z.string().max(50).optional(),
  ticketTypeName: z.string().min(1).max(100),
  ticketPriceHalire: z.number().int().min(0).max(10_000_000),
  totalQty: z.number().int().min(1).max(100000),
  zone: z.string().max(100).optional(),
  isSeated: z.boolean().default(false),
  description: z.string().max(2000).optional(),
});

const inputSchema = z.object({
  rows: z.array(rowSchema).min(1).max(200),
  dryRun: z.boolean().default(false),
});

interface RowResult {
  index: number;
  title: string;
  success: boolean;
  eventId?: string;
  error?: string;
  seatsInserted?: number;
}

export async function POST(req: NextRequest): Promise<Response> {
  const promoter = await requirePromoter(req);
  if (!promoter || promoter.status !== 'active') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = inputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.issues },
      { status: 422 },
    );
  }
  const { rows, dryRun } = parsed.data;

  const client = await db().connect();
  const results: RowResult[] = [];
  try {
    await client.query('BEGIN');

    // Načti venue + ticket type validation context jednou
    const venueIds = Array.from(new Set(rows.map((r) => r.venueId)));
    const venuesRes = await client.query<{ id: string }>(
      `SELECT id FROM catalog.venues WHERE id = ANY($1::uuid[]) AND archived_at IS NULL`,
      [venueIds],
    );
    const validVenueIds = new Set(venuesRes.rows.map((r) => r.id));

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!;
      try {
        if (!validVenueIds.has(row.venueId)) {
          results.push({
            index: i,
            title: row.title,
            success: false,
            error: `Sál ${row.venueId} neexistuje nebo je archivovaný.`,
          });
          continue;
        }

        if (dryRun) {
          results.push({ index: i, title: row.title, success: true });
          continue;
        }

        // 1) Event
        const evRes = await client.query<{ id: string }>(
          `INSERT INTO catalog.events
             (organizer_id, promoter_id, venue_id, title, description, category,
              date_start, status, event_type, currency, timezone)
           VALUES ($1, $1, $2, $3, $4, $5,
                   $6, 'draft', 'concert', 'CZK', 'Europe/Prague')
           RETURNING id`,
          [
            promoter.promoterId,
            row.venueId,
            row.title,
            row.description ?? null,
            row.category ?? null,
            row.dateStart,
          ],
        );
        const eventId = evRes.rows[0]!.id;

        // 2) Ticket type
        await client.query(
          `INSERT INTO catalog.ticket_types
             (event_id, name, kind, base_price, total_qty, remaining_qty,
              zone, is_seated, visibility, attendance_type)
           VALUES ($1, $2, $3, $4, $5, $5, $6, $7, 'public', 'physical')`,
          [
            eventId,
            row.ticketTypeName,
            row.isSeated ? 'seated' : 'standing',
            row.ticketPriceHalire,
            row.totalQty,
            row.zone ?? null,
            row.isSeated,
          ],
        );

        // 3) Seated event → copy layout
        let seatsInserted = 0;
        if (row.isSeated && row.zone) {
          const r = await copyLayoutToEventSeats(client, eventId);
          seatsInserted = r.insertedSeats;
        }

        results.push({ index: i, title: row.title, success: true, eventId, seatsInserted });
      } catch (e) {
        results.push({
          index: i,
          title: row.title,
          success: false,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    const successCount = results.filter((r) => r.success).length;
    const failureCount = results.length - successCount;

    if (dryRun) {
      await client.query('ROLLBACK');
    } else {
      await client.query('COMMIT');
    }

    return NextResponse.json({
      dryRun,
      totalRows: rows.length,
      successCount,
      failureCount,
      results,
    });
  } catch (e) {
    await client.query('ROLLBACK');
    return NextResponse.json(
      { error: 'INTERNAL_ERROR', message: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}
