/**
 * POST /api/admin/bank-transfers/reconcile
 *
 * Body:
 *   { lines: [{ amountHalire, variableSymbol?, payerName?, message?, paidAt?, rawLine? }],
 *     source: 'manual_csv'|'kb_api'|... , filename? }
 *
 * Algoritmus:
 *   1. Vytvoří orders.bank_transfer_imports header
 *   2. Pro každou line:
 *      - INSERT do bank_transfer_lines
 *      - Pokud VS nastaven: SELECT order WHERE variable_symbol = VS AND status = 'pending'
 *        AND amount = paid_amount AND promoter matches → auto-match
 *        UPDATE order.status = 'paid', paid_at = line.paid_at OR NOW()
 *        UPDATE line.match_status = 'matched', matched_order_id, matched_at
 *      - Trigger /api/internal/order-completed pro paid orders (fire-and-forget)
 *   3. Vrátí summary {matched, unmatched, duplicate}
 *
 * Manual match přes PATCH /api/admin/bank-transfers/lines/[id] (samostatný endpoint).
 */

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { z } from 'zod';
import { requirePromoter } from '@/lib/admin-auth';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

const lineSchema = z.object({
  amountHalire: z.number().int().min(1).max(1_000_000_000),
  variableSymbol: z.string().max(40).optional(),
  payerName: z.string().max(200).optional(),
  message: z.string().max(500).optional(),
  paidAt: z.string().datetime().optional(),
  rawLine: z.record(z.unknown()).optional(),
});

const schema = z.object({
  source: z.enum(['manual_csv', 'kb_api', 'cs_api', 'fio_api', 'csob_api']).default('manual_csv'),
  filename: z.string().max(200).optional(),
  lines: z.array(lineSchema).min(1).max(1000),
});

export async function POST(req: NextRequest): Promise<Response> {
  const promoter = await requirePromoter(req);
  if (!promoter || promoter.status !== 'active') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body: unknown = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'BAD_INPUT', issues: parsed.error.issues },
      { status: 422 },
    );
  }

  const matchedOrderIds: string[] = [];
  const client = await db().connect();
  try {
    await client.query('BEGIN');

    const importRes = await client.query<{ id: string }>(
      `INSERT INTO orders.bank_transfer_imports
         (promoter_id, uploaded_by, source, filename, row_count)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [promoter.promoterId, promoter.userId, parsed.data.source, parsed.data.filename ?? null, parsed.data.lines.length],
    );
    const importId = importRes.rows[0].id;

    let matched = 0;
    let unmatched = 0;
    let duplicates = 0;

    for (const line of parsed.data.lines) {
      let matchStatus: 'matched' | 'unmatched' | 'duplicate' = 'unmatched';
      let matchedOrderId: string | null = null;

      if (line.variableSymbol) {
        // Auto-match: VS + amount + promoter match + pending status
        const m = await client.query<{ id: string; status: string }>(
          `SELECT o.id, o.status
           FROM orders.orders o
           JOIN catalog.events e ON e.id = o.event_id
           WHERE o.variable_symbol = $1
             AND o.total_amount = $2
             AND e.promoter_id = $3
           FOR UPDATE`,
          [line.variableSymbol, line.amountHalire, promoter.promoterId],
        );

        if (m.rows.length === 1) {
          const order = m.rows[0];
          if (order.status === 'pending') {
            await client.query(
              `UPDATE orders.orders
               SET status = 'paid', paid_at = COALESCE($2::timestamptz, NOW()), updated_at = NOW()
               WHERE id = $1`,
              [order.id, line.paidAt ?? null],
            );
            matchedOrderId = order.id;
            matchStatus = 'matched';
            matched += 1;
            matchedOrderIds.push(order.id);
          } else if (order.status === 'paid') {
            matchStatus = 'duplicate';
            duplicates += 1;
            matchedOrderId = order.id;
          }
        } else {
          unmatched += 1;
        }
      } else {
        unmatched += 1;
      }

      await client.query(
        `INSERT INTO orders.bank_transfer_lines
           (import_id, promoter_id, amount_halire, variable_symbol, payer_name,
            message, paid_at, matched_order_id, match_status, matched_at, raw_line)
         VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz, $8, $9, $10::timestamptz, $11::jsonb)`,
        [
          importId,
          promoter.promoterId,
          line.amountHalire,
          line.variableSymbol ?? null,
          line.payerName ?? null,
          line.message ?? null,
          line.paidAt ?? null,
          matchedOrderId,
          matchStatus,
          matchStatus !== 'unmatched' ? new Date().toISOString() : null,
          line.rawLine ? JSON.stringify(line.rawLine) : null,
        ],
      );
    }

    await client.query(
      `UPDATE orders.bank_transfer_imports
       SET matched_count = $2, unmatched_count = $3
       WHERE id = $1`,
      [importId, matched, unmatched + duplicates],
    );

    await client.query('COMMIT');

    // Fire-and-forget trigger order-completed pro matched orders
    void (async () => {
      const internalToken = process.env.INTERNAL_SERVICE_TOKEN;
      if (!internalToken) return;
      const appUrl = process.env.APP_URL ?? 'http://localhost:3000';
      for (const oid of matchedOrderIds) {
        try {
          await fetch(`${appUrl}/api/internal/order-completed`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-internal-token': internalToken },
            body: JSON.stringify({ orderId: oid }),
          });
        } catch (err) {
          console.error('[reconcile] order-completed failed for', oid, err);
        }
      }
    })();

    return NextResponse.json({
      ok: true,
      importId,
      matched,
      unmatched,
      duplicates,
      total: parsed.data.lines.length,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[reconcile]', err);
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
  } finally {
    client.release();
  }
}
