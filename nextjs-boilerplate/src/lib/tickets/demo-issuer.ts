/**
 * Demo ticket issuer — zjednodušená verze pro lokální demo.
 *
 * Liší se od `src/lib/ticket-issuer.ts` (má pre-existing TS dluh + očekává
 * rozšířené schéma tickets.tickets, které v aktuální DB není). Tady pracujeme
 * jen se sloupci, které skutečně existují podle `\d tickets.tickets`:
 *   id, order_id, ticket_type_id, owner_id, original_owner_id, seat_id,
 *   status, totp_secret_encrypted, totp_secret_iv, original_price.
 *
 * TOTP secret (RFC 6238, 20 B = 160 bit) šifrujeme přes @tixly/crypto.
 * Idempotent: pokud už pro order existují, vrátí existující.
 */

import { randomBytes, randomUUID } from 'crypto';
import type { QueryResult, QueryResultRow } from 'pg';
import { encryptSecret } from '@/lib/crypto';

// Strukturální typ — splňují ho pg.Pool, pg.PoolClient i rls-pool RlsAwarePool
// (db()). Umožní volat issuer jak s transakčním clientem, tak se sdíleným db().
type Queryable = {
  query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: unknown[],
  ): Promise<QueryResult<R>>;
};

export interface IssuedTicket {
  ticketId: string;
  ticketTypeName: string;
  totpSecretBase32: string;
  totpSecretRaw: Buffer;
}

interface OrderItemRow {
  id: string;
  ticket_type_id: string;
  quantity: number;
  unit_price: number;
  ticket_type_name: string;
}

interface ExistingTicketRow {
  id: string;
  ticket_type_id: string;
  totp_secret_encrypted: Buffer;
  totp_secret_iv: Buffer;
  ticket_type_name: string;
}

interface OrderRow {
  user_id: string;
  holder_names: string[] | null;
}

/**
 * Vydá lístky pro objednávku. Idempotent + odolné proti souběžnému dvojímu vydání (#4 RACE).
 *
 * Ochrana (A+B, mig 450):
 *   A) UNIQUE(order_id, ticket_type_id, ticket_seq) + ON CONFLICT DO NOTHING — DB-level záruka
 *      nezávislá na calleru/spojení (kryje i pool fire-and-forget callery). ticket_seq je
 *      deterministický (i-tý lístek daného typu, pořadí položek stabilizováno ORDER BY oi.id),
 *      takže dva souběžné běhy kolidují na tomtéž (order,type,seq).
 *   B) pg_advisory_xact_lock(order) — serializuje souběžné běhy; ÚČINNÉ jen když volající drží
 *      transakci (tx-callery: pos/reseller/press/comps/guestlist/mobile/kiosk). V autocommitu
 *      (pool callery) je to no-op — tam drží čistě A.
 *
 * IDEÁLNĚ volat s transakčním clientem (jedno spojení, BEGIN), aby platilo i B.
 */
export async function issueTicketsForOrder(
  orderId: string,
  db: Queryable,
): Promise<IssuedTicket[]> {
  // B) Serializace souběžných issuerů na týž order (no-op v autocommitu; A drží vždy).
  await db.query(`SELECT pg_advisory_xact_lock(hashtext('issue-tickets:' || $1::text))`, [orderId]);

  // Idempotent check (pod lockem u tx-callerů → spolehlivé)
  const existing = await db.query<ExistingTicketRow>(
    `SELECT t.id, t.ticket_type_id, t.totp_secret_encrypted, t.totp_secret_iv,
            tt.name AS ticket_type_name
     FROM tickets.tickets t
     JOIN catalog.ticket_types tt ON tt.id = t.ticket_type_id
     WHERE t.order_id = $1`,
    [orderId],
  );
  if (existing.rows.length > 0) {
    // Ticket už existuje — vrátíme bez secretu (není možné dešifrovat bez heslové orchestrace)
    // Pro demo posíláme jen už-existující ticketId; PDF nebude regenerován.
    return existing.rows.map((r) => ({
      ticketId: r.id,
      ticketTypeName: r.ticket_type_name,
      totpSecretBase32: '',
      totpSecretRaw: Buffer.alloc(0),
    }));
  }

  // Najdi user_id + holder_names z orderu
  const orderRes = await db.query<OrderRow>(
    `SELECT user_id, holder_names FROM orders.orders WHERE id = $1`,
    [orderId],
  );
  if (orderRes.rows.length === 0) {
    throw new Error(`Order ${orderId} not found`);
  }
  const ownerId = orderRes.rows[0].user_id;
  const holderNames = orderRes.rows[0].holder_names ?? [];
  let holderNameIdx = 0;

  // Načti položky
  const itemsRes = await db.query<OrderItemRow>(
    `SELECT oi.id, oi.ticket_type_id, oi.quantity, oi.unit_price,
            tt.name AS ticket_type_name
     FROM orders.order_items oi
     JOIN catalog.ticket_types tt ON tt.id = oi.ticket_type_id
     WHERE oi.order_id = $1
     ORDER BY oi.id`,   // stabilní pořadí → deterministický ticket_seq napříč souběžnými běhy
    [orderId],
  );

  // Get seats for this order (if any) — sequential bind per ticket
  const seatsRes = await db.query<{ id: string; ticket_type_id: string }>(
    `SELECT id, ticket_type_id FROM catalog.event_seats
     WHERE order_id = $1 AND status = 'sold'
     ORDER BY sector, row, seat_number`,
    [orderId],
  );
  const seatsByType = new Map<string, string[]>();
  for (const s of seatsRes.rows) {
    const arr = seatsByType.get(s.ticket_type_id) ?? [];
    arr.push(s.id);
    seatsByType.set(s.ticket_type_id, arr);
  }

  const issued: IssuedTicket[] = [];
  let attempted = 0;
  // Running counter per ticket_type → deterministický ticket_seq (0-based) napříč souběžnými běhy.
  const seqByType = new Map<string, number>();
  for (const item of itemsRes.rows) {
    const typeSeats = seatsByType.get(item.ticket_type_id) ?? [];
    for (let i = 0; i < item.quantity; i++) {
      attempted++;
      const seq = seqByType.get(item.ticket_type_id) ?? 0;
      seqByType.set(item.ticket_type_id, seq + 1);
      const ticketId = randomUUID();
      const seatId = typeSeats[seq] ?? null;
      const totpSecretRaw = randomBytes(20);
      // crypto/index.ts exports encryptSecret(plaintext): base64 (IV+ct+tag bundled).
      // DB columns totp_secret_encrypted + totp_secret_iv are BYTEA — we store
      // the full bundle in totp_secret_encrypted and leave iv empty (decrypt
      // recovers IV from the bundle). The iv column kept for legacy schema compat.
      const encryptedBundle = Buffer.from(
        encryptSecret(totpSecretRaw.toString('base64')),
        'base64',
      );

      const holderName = holderNames[holderNameIdx++] ?? null;

      // A) ON CONFLICT DO NOTHING na UNIQUE(order_id,ticket_type_id,ticket_seq) — souběžný
      // duplikát prostě neprojde. rowCount === 0 → tento (order,type,seq) už vydal jiný běh.
      const ins = await db.query(
        `INSERT INTO tickets.tickets
           (id, order_id, ticket_type_id, owner_id, original_owner_id,
            status, totp_secret_encrypted, totp_secret_iv, original_price, event_seat_id,
            holder_name, ticket_seq)
         VALUES ($1, $2, $3, $4, $4, 'valid', $5, $6, $7, $8, $9, $10)
         ON CONFLICT (order_id, ticket_type_id, ticket_seq) DO NOTHING`,
        [
          ticketId,
          orderId,
          item.ticket_type_id,
          ownerId,
          encryptedBundle,
          Buffer.alloc(0),
          item.unit_price,
          seatId,
          holderName,
          seq,
        ],
      );
      if (ins.rowCount === 0) continue; // duplikát — side-effecty NEspouštět (seat/reminders/issued)

      if (seatId) {
        await db.query(
          `UPDATE catalog.event_seats SET ticket_id = $2 WHERE id = $1`,
          [seatId, ticketId],
        );
      }

      // Pre-event reminders (Phase S.2): naplánovat 1 týden / 1 den / 1 hodinu před event
      await db.query(
        `INSERT INTO marketing.event_reminders (ticket_id, reminder_type, scheduled_at)
         SELECT $1, 'week_before', e.date_start - INTERVAL '7 days'
         FROM orders.orders o JOIN catalog.events e ON e.id = o.event_id
         WHERE o.id = $2 AND e.date_start - INTERVAL '7 days' > NOW()
         ON CONFLICT DO NOTHING`,
        [ticketId, orderId],
      );
      await db.query(
        `INSERT INTO marketing.event_reminders (ticket_id, reminder_type, scheduled_at)
         SELECT $1, 'day_before', e.date_start - INTERVAL '1 day'
         FROM orders.orders o JOIN catalog.events e ON e.id = o.event_id
         WHERE o.id = $2 AND e.date_start - INTERVAL '1 day' > NOW()
         ON CONFLICT DO NOTHING`,
        [ticketId, orderId],
      );
      await db.query(
        `INSERT INTO marketing.event_reminders (ticket_id, reminder_type, scheduled_at)
         SELECT $1, 'hour_before', e.date_start - INTERVAL '1 hour'
         FROM orders.orders o JOIN catalog.events e ON e.id = o.event_id
         WHERE o.id = $2 AND e.date_start - INTERVAL '1 hour' > NOW()
         ON CONFLICT DO NOTHING`,
        [ticketId, orderId],
      );

      issued.push({
        ticketId,
        ticketTypeName: item.ticket_type_name,
        totpSecretBase32: base32Encode(totpSecretRaw),
        totpSecretRaw,
      });
    }
  }

  // Kolize na některém seq (souběžný běh nás předběhl) → vrať PLNOU sadu lístků objednávky
  // (re-read), ne jen ty naše, aby caller (PDF/e-mail) nedostal půlku. Náš TOTP secret držíme
  // u reálně vložených; u cizích je '' (jako idempotent větev — secret nelze zpětně dešifrovat).
  if (issued.length < attempted) {
    const all = await db.query<ExistingTicketRow>(
      `SELECT t.id, t.ticket_type_id, t.totp_secret_encrypted, t.totp_secret_iv,
              tt.name AS ticket_type_name
       FROM tickets.tickets t
       JOIN catalog.ticket_types tt ON tt.id = t.ticket_type_id
       WHERE t.order_id = $1`,
      [orderId],
    );
    const mine = new Map(issued.map((t) => [t.ticketId, t]));
    return all.rows.map((r) => mine.get(r.id) ?? {
      ticketId: r.id,
      ticketTypeName: r.ticket_type_name,
      totpSecretBase32: '',
      totpSecretRaw: Buffer.alloc(0),
    });
  }

  return issued;
}

/** Base32 encoding (RFC 4648) — pro otpauth:// URI. */
export function base32Encode(buf: Buffer): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  let out = '';
  for (let i = 0; i < buf.length; i++) {
    value = (value << 8) | buf[i];
    bits += 8;
    while (bits >= 5) {
      out += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    out += alphabet[(value << (5 - bits)) & 31];
  }
  return out;
}
