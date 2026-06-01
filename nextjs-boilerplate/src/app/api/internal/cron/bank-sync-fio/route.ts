/**
 * POST /api/internal/cron/bank-sync-fio
 *
 * Pulluje nové transakce z Fio Bank API per promotér, vytvoří import
 * v orders.bank_transfer_imports, zapíše do bank_transfer_lines + auto-match
 * podle VS + amount.
 *
 * Použití: Vercel cron 1× za 5 min (Fio rate limit 1 call / 30s per token).
 *
 * Auth: x-internal-token.
 */

import { timingSafeEqual } from 'crypto';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';
import { NextRequest, NextResponse } from 'next/server';
import { fetchLastFioTransactions } from '@/lib/bank/fio';
import { decryptSecret } from '@/lib/crypto';


function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export async function POST(req: NextRequest): Promise<Response> {
  return runWithServiceContext(async () => {

  const token = req.headers.get('x-internal-token') ?? '';
  const expected = process.env.INTERNAL_SERVICE_TOKEN ?? '';
  if (!expected || !safeEqual(token, expected)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const creds = await db().query<{
    id: string;
    promoter_id: string;
    token_encrypted: string;
    account_iban: string | null;
  }>(
    `SELECT id, promoter_id, token_encrypted, account_iban
     FROM platform.bank_credentials
     WHERE provider = 'fio' AND active = TRUE`,
  );

  const results: Array<{
    promoterId: string;
    status: string;
    matched?: number;
    unmatched?: number;
    pulled?: number;
    reason?: string;
  }> = [];

  for (const cred of creds.rows) {
    try {
      const fioToken = decryptSecret(cred.token_encrypted);
      const { transactions, iban } = await fetchLastFioTransactions(fioToken);

      // Filter jen incoming credits (amount > 0)
      const incoming = transactions.filter((t) => t.amountHalire > 0);
      if (incoming.length === 0) {
        await db().query(
          `UPDATE platform.bank_credentials
           SET last_sync_at = NOW(), last_sync_status = 'ok'
           WHERE id = $1`,
          [cred.id],
        );
        results.push({ promoterId: cred.promoter_id, status: 'no_transactions', pulled: 0 });
        continue;
      }

      // Vytvoř import header
      const importRes = await db().query<{ id: string }>(
        `INSERT INTO orders.bank_transfer_imports
           (promoter_id, uploaded_by, source, filename, row_count)
         VALUES ($1, $1, 'fio_api', $2, $3)
         RETURNING id`,
        [cred.promoter_id, `fio-auto-${new Date().toISOString().slice(0, 10)}`, incoming.length],
      );
      const importId = importRes.rows[0].id;

      let matched = 0;
      let unmatched = 0;
      const matchedOrderIds: string[] = [];

      for (const tx of incoming) {
        let matchStatus: 'matched' | 'unmatched' | 'duplicate' = 'unmatched';
        let matchedOrderId: string | null = null;

        if (tx.variableSymbol) {
          const m = await db().query<{ id: string; status: string }>(
            `SELECT o.id, o.status
             FROM orders.orders o
             JOIN catalog.events e ON e.id = o.event_id
             WHERE o.variable_symbol = $1
               AND o.total_amount = $2
               AND e.promoter_id = $3`,
            [tx.variableSymbol, tx.amountHalire, cred.promoter_id],
          );

          if (m.rows.length === 1) {
            const order = m.rows[0];
            if (order.status === 'pending') {
              await db().query(
                `UPDATE orders.orders
                 SET status = 'paid', paid_at = $2::timestamptz, updated_at = NOW()
                 WHERE id = $1`,
                [order.id, `${tx.date}T12:00:00Z`],
              );
              matched += 1;
              matchStatus = 'matched';
              matchedOrderId = order.id;
              matchedOrderIds.push(order.id);
            } else if (order.status === 'paid') {
              matchStatus = 'duplicate';
              matchedOrderId = order.id;
            }
          } else {
            unmatched += 1;
          }
        } else {
          unmatched += 1;
        }

        await db().query(
          `INSERT INTO orders.bank_transfer_lines
             (import_id, promoter_id, amount_halire, variable_symbol, payer_name,
              message, paid_at, matched_order_id, match_status, matched_at, raw_line)
           VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz, $8, $9, $10::timestamptz, $11::jsonb)`,
          [
            importId,
            cred.promoter_id,
            tx.amountHalire,
            tx.variableSymbol,
            tx.payerName,
            tx.message,
            `${tx.date}T12:00:00Z`,
            matchedOrderId,
            matchStatus,
            matchStatus !== 'unmatched' ? new Date().toISOString() : null,
            JSON.stringify({ fio_id: tx.id, type: tx.typeText, currency: tx.currency }),
          ],
        );
      }

      await db().query(
        `UPDATE orders.bank_transfer_imports
         SET matched_count = $2, unmatched_count = $3
         WHERE id = $1`,
        [importId, matched, unmatched],
      );

      // Update IBAN pokud chybí
      if (iban && !cred.account_iban) {
        await db().query(
          `UPDATE platform.bank_credentials SET account_iban = $2 WHERE id = $1`,
          [cred.id, iban],
        );
      }

      await db().query(
        `UPDATE platform.bank_credentials
         SET last_sync_at = NOW(), last_sync_status = 'ok'
         WHERE id = $1`,
        [cred.id],
      );

      // Fire-and-forget order-completed pro matched
      void (async () => {
        const internalToken = process.env.INTERNAL_SERVICE_TOKEN;
        const appUrl = process.env.APP_URL ?? 'http://localhost:3000';
        if (!internalToken) return;
        for (const oid of matchedOrderIds) {
          await fetch(`${appUrl}/api/internal/order-completed`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-internal-token': internalToken },
            body: JSON.stringify({ orderId: oid }),
          }).catch((err) => console.error('[fio-sync] order-completed', oid, err));
        }
      })();

      results.push({
        promoterId: cred.promoter_id,
        status: 'ok',
        matched,
        unmatched,
        pulled: incoming.length,
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'unknown';
      await db().query(
        `UPDATE platform.bank_credentials
         SET last_sync_at = NOW(), last_sync_status = $2
         WHERE id = $1`,
        [cred.id, `failed: ${reason.slice(0, 200)}`],
      );
      results.push({ promoterId: cred.promoter_id, status: 'failed', reason });
    }
  }

  return NextResponse.json({ ok: true, results });

  });
}
