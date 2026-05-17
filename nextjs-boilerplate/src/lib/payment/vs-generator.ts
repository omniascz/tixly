/**
 * Variable Symbol generator pro bank transfer platby (CZ + SR formát).
 *
 * Formát: 10-digit numeric VS = EEEEEE + NNNN
 *   EEEEEE = 6-digit event short ID (deterministicky z event UUID)
 *   NNNN   = 4-digit per-event sequence (max 9999 lístků/akce)
 *
 * Promotér vidí v bank statement přímo akci, k níž platba patří.
 * Pro festivaly s >9999 lístky padá na N5 fallback (5-digit sequence, EEEEE prefix).
 *
 * Bank reconciliation:
 *   Bank line VS = "4012340023" → match na orders kde event_short_id=401234
 *                                  a per_event_sequence=23
 */

import type { Pool, PoolClient } from 'pg';

/**
 * Deterministicky odvodí 6-digit event short ID z UUID.
 *
 * UUID hex prvních 8 chars → integer mod 1_000_000 → padded.
 * Stejný event vždy dostane stejný short ID, žádný DB hit potřeba.
 */
export function eventShortId(eventId: string): string {
  // UUID format: 00000000-0000-4000-a000-000000000401
  const hex = eventId.replace(/-/g, '').slice(0, 8);
  const num = parseInt(hex, 16);
  // mod 1_000_000 — kolize ~1 per milion eventů (přijatelné)
  const short = num % 1_000_000;
  return String(short).padStart(6, '0');
}

/**
 * Spočítá další per-event sekvenci pro bank_transfer order.
 * COUNT(*) + 1 — pro pilot scale (low concurrency) bezpečné.
 *
 * Pro 9999+ lístků padá zpět na 5-digit (EEEEE NNNNN, total 10 digits).
 */
async function nextEventSequence(eventId: string, db: Pool | PoolClient): Promise<number> {
  const r = await db.query<{ next_seq: string }>(
    `SELECT COUNT(*) + 1 AS next_seq
     FROM orders.orders
     WHERE event_id = $1 AND variable_symbol IS NOT NULL`,
    [eventId],
  );
  return parseInt(r.rows[0]!.next_seq, 10);
}

/**
 * Vygeneruj VS pro objednávku. Volat v rámci transakce s order insertem.
 *
 * @returns 10-digit numeric VS string
 */
export async function generateVariableSymbol(
  eventId: string,
  db: Pool | PoolClient,
): Promise<string> {
  const shortId = eventShortId(eventId);
  const seq = await nextEventSequence(eventId, db);

  if (seq <= 9999) {
    // Standard formát: EEEEEE + NNNN
    return shortId + String(seq).padStart(4, '0');
  }

  // Festival fallback: EEEEE + NNNNN (5+5, max 99 999 / event)
  if (seq <= 99999) {
    return shortId.slice(0, 5) + String(seq).padStart(5, '0');
  }

  // Ultra-festival fallback: EEEE + NNNNNN (4+6, max 999 999 / event)
  if (seq <= 999999) {
    return shortId.slice(0, 4) + String(seq).padStart(6, '0');
  }

  throw new Error(
    `VS overflow: event ${eventId} má ${seq} bank_transfer objednávek (limit 999 999).`,
  );
}

/**
 * Parse VS zpět na (event_short_id, sequence). Pro bank reconciliation.
 *
 * Nelze 100 % jednoznačně určit délku prefix bez znalosti formátu, takže
 * vracíme všechny tři varianty a caller zkusí matchnout.
 */
export function parseVariableSymbol(vs: string): Array<{ eventShortId: string; sequence: number }> {
  if (!/^\d{10}$/.test(vs)) return [];

  return [
    // Standard 6+4
    { eventShortId: vs.slice(0, 6), sequence: parseInt(vs.slice(6), 10) },
    // Festival 5+5
    { eventShortId: vs.slice(0, 5), sequence: parseInt(vs.slice(5), 10) },
    // Ultra 4+6
    { eventShortId: vs.slice(0, 4), sequence: parseInt(vs.slice(4), 10) },
  ];
}
