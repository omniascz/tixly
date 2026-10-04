/**
 * Kolo 8 / krok 3 — pojmenované blokace míst (catalog.seat_blocks + seat_block_seats nad event_seats).
 *
 * Blokované místo: event_seats.status = 'blocked', hold_kind = 'block', hold_label = název blokace → online nákup
 * ani držení ho nevezme (chtějí 'available'), pokladna ho vidí s názvem. Kapacita typu vstupenky (remaining_qty)
 * se blokací sníží, uvolněním vrátí; vydání / prodej z blokace ji už znovu neodečte.
 * Všechny změny pod zámkem řádků event_seats (FOR UPDATE, pevné pořadí podle id) → uvolnění a současný nákup
 * nebo prodej na pokladně skončí jedním prodejem.
 * Běží v transakci volajícího s RLS kontextem pořadatele.
 */
import { randomUUID } from 'crypto';
import { issueTicketsForOrder } from '@/lib/tickets/demo-issuer';

/** Pool (db()) i klient v transakci. */
interface Q {
  query<R extends Record<string, unknown> = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: R[] }>;
}

export class BlockError extends Error {
  constructor(public code: 'NOT_FOUND' | 'NAME_TAKEN' | 'NO_SEATS' | 'SEAT_NOT_IN_BLOCK', message: string, public status = 422) {
    super(message);
  }
}

interface SeatRow extends Record<string, unknown> { id: string; status: string; hold_kind: string | null; ticket_type_id: string | null; sector: string; row: string; seat_number: string }

async function adjustCapacity(q: Q, seats: Array<{ ticket_type_id: string | null }>, delta: 1 | -1): Promise<void> {
  const byType = new Map<string, number>();
  for (const s of seats) if (s.ticket_type_id) byType.set(s.ticket_type_id, (byType.get(s.ticket_type_id) ?? 0) + 1);
  for (const [tt, n] of byType) {
    await q.query(
      `UPDATE catalog.ticket_types SET remaining_qty = GREATEST(0, LEAST(total_qty, remaining_qty + $2)) WHERE id = $1`,
      [tt, delta * n],
    );
  }
}

export async function assertEventOwned(q: Q, promoterId: string, eventId: string): Promise<void> {
  const r = await q.query(`SELECT 1 FROM catalog.events WHERE id = $1 AND promoter_id = $2`, [eventId, promoterId]);
  if (r.rows.length === 0) throw new BlockError('NOT_FOUND', 'Termín nenalezen.', 404);
}

export async function createBlock(
  q: Q, ctx: { promoterId: string; userId: string }, eventId: string,
  input: { name: string; note?: string | null; color?: string | null; seatIds?: string[]; sector?: string | null },
): Promise<{ block: { id: string; name: string }; blocked: number; skipped: string[] }> {
  await assertEventOwned(q, ctx.promoterId, eventId);
  let block: { id: string; name: string };
  try {
    await q.query('SAVEPOINT block_insert');
    block = (await q.query<{ id: string; name: string }>(
      `INSERT INTO catalog.seat_blocks (event_id, promoter_id, name, note, color, created_by_user_id)
       VALUES ($1, $2, $3, $4, COALESCE($5, '#6b7280'), $6) RETURNING id, name`,
      [eventId, ctx.promoterId, input.name.trim(), input.note ?? null, input.color ?? null, ctx.userId],
    )).rows[0];
    await q.query('RELEASE SAVEPOINT block_insert');
  } catch (err) {
    await q.query('ROLLBACK TO SAVEPOINT block_insert');
    if ((err as { code?: string }).code === '23505') throw new BlockError('NAME_TAKEN', `Blokace „${input.name}" už v termínu existuje.`, 409);
    throw err;
  }
  const seats = (await q.query<SeatRow>(
    `SELECT id, status, hold_kind, ticket_type_id, sector, row, seat_number FROM catalog.event_seats
      WHERE event_id = $1 AND (id = ANY($2::uuid[]) OR ($3::text IS NOT NULL AND sector = $3))
      ORDER BY id FOR UPDATE`,
    [eventId, input.seatIds ?? [], input.sector ?? null],
  )).rows;
  if (seats.length === 0) throw new BlockError('NO_SEATS', 'Vyberte místa nebo sekci.');
  const free = seats.filter((s) => s.status === 'available');
  const skipped = seats.filter((s) => s.status !== 'available').map((s) => `${s.sector} ${s.row}/${s.seat_number}`);
  if (free.length > 0) {
    const ids = free.map((s) => s.id);
    await q.query(
      `UPDATE catalog.event_seats SET status = 'blocked', hold_kind = 'block', hold_label = $2, hold_user_id = NULL,
              hold_until = NULL, notes = NULL, updated_at = now()
        WHERE id = ANY($1::uuid[])`,
      [ids, block.name],
    );
    await q.query(
      `INSERT INTO catalog.seat_block_seats (block_id, seat_id, promoter_id) SELECT $1, unnest($2::uuid[]), $3`,
      [block.id, ids, ctx.promoterId],
    );
    await adjustCapacity(q, free, -1);
  }
  return { block, blocked: free.length, skipped };
}

/** Místa blokace ve stavu blocked (zamknutá). seatIds = podmnožina, prázdné = všechna. */
async function lockBlockSeats(q: Q, ctx: { promoterId: string }, eventId: string, blockId: string, seatIds?: string[]) {
  const blk = (await q.query<{ name: string }>(
    `SELECT name FROM catalog.seat_blocks WHERE id = $1 AND event_id = $2 AND promoter_id = $3`, [blockId, eventId, ctx.promoterId],
  )).rows[0];
  if (!blk) throw new BlockError('NOT_FOUND', 'Blokace nenalezena.', 404);
  const rows = (await q.query<SeatRow>(
    `SELECT es.id, es.status, es.hold_kind, es.ticket_type_id, es.sector, es.row, es.seat_number
       FROM catalog.event_seats es
       JOIN catalog.seat_block_seats bs ON bs.seat_id = es.id AND bs.block_id = $1 AND bs.state = 'blocked'
      WHERE es.event_id = $2 AND ($3::uuid[] IS NULL OR es.id = ANY($3::uuid[]))
      ORDER BY es.id FOR UPDATE OF es`,
    [blockId, eventId, seatIds && seatIds.length > 0 ? seatIds : null],
  )).rows.filter((s) => s.status === 'blocked' && s.hold_kind === 'block');
  if (seatIds && seatIds.length > 0 && rows.length !== new Set(seatIds).size) {
    throw new BlockError('SEAT_NOT_IN_BLOCK', 'Některé místo v blokaci není (nebo už bylo uvolněno, vydáno či prodáno).', 409);
  }
  return { name: blk.name, seats: rows };
}

export async function releaseBlockSeats(q: Q, ctx: { promoterId: string }, eventId: string, blockId: string, seatIds?: string[]): Promise<{ released: number }> {
  const { seats } = await lockBlockSeats(q, ctx, eventId, blockId, seatIds);
  if (seats.length === 0) return { released: 0 };
  const ids = seats.map((s) => s.id);
  await q.query(
    `UPDATE catalog.event_seats SET status = 'available', hold_kind = NULL, hold_label = NULL, hold_until = NULL, updated_at = now()
      WHERE id = ANY($1::uuid[])`,
    [ids],
  );
  await q.query(`UPDATE catalog.seat_block_seats SET state = 'released', updated_at = now() WHERE block_id = $1 AND seat_id = ANY($2::uuid[])`, [blockId, ids]);
  await adjustCapacity(q, seats, 1);
  return { released: ids.length };
}

/** Označí místa blokace jako použitá objednávkou (prodej na pokladně / firemní objednávka). */
export async function consumeBlockSeats(q: Q, blockId: string, seatIds: string[], state: 'sold' | 'corporate' | 'issued', orderId: string): Promise<void> {
  await q.query(
    `UPDATE catalog.seat_block_seats SET state = $3, order_id = $4, updated_at = now() WHERE block_id = $1 AND seat_id = ANY($2::uuid[])`,
    [blockId, seatIds, state, orderId],
  );
}

export async function lockSeatsForBlockSale(q: Q, ctx: { promoterId: string }, eventId: string, blockId: string, seatIds: string[]): Promise<SeatRow[]> {
  return (await lockBlockSeats(q, ctx, eventId, blockId, seatIds)).seats;
}

/** Volné vstupenky z blokace na jména (jedna objednávka, cena 0, payment_provider 'comp'). */
export async function issueBlockComps(
  q: Q, ctx: { promoterId: string }, eventId: string, blockId: string, recipientUserId: string,
  seats: Array<{ seatId: string; holderName: string }>,
): Promise<{ orderId: string; tickets: number }> {
  const { name, seats: locked } = await lockBlockSeats(q, ctx, eventId, blockId, seats.map((s) => s.seatId));
  const currency = (await q.query<{ currency: string }>(`SELECT currency FROM catalog.events WHERE id = $1`, [eventId])).rows[0].currency;
  const orderId = randomUUID();
  await q.query(
    `INSERT INTO orders.orders
       (id, user_id, event_id, status, total_amount, currency, locale, payment_provider, idempotency_key, discount_halire,
        requires_age_verification, paid_at, expires_at, comp_type, comp_notes, created_at, updated_at)
     VALUES ($1, $2, $3, 'paid', 0, $4, 'cs', 'comp', $5, 0, false, now(), now() + interval '7 days', 'press', $6, now(), now())`,
    [orderId, recipientUserId, eventId, currency, randomUUID(), `Blokace: ${name}`],
  );
  for (const s of locked) {
    await q.query(
      `INSERT INTO orders.order_items (order_id, ticket_type_id, quantity, unit_price, total_price, seat_id) VALUES ($1, $2, 1, 0, 0, $3)`,
      [orderId, s.ticket_type_id, s.id],
    );
  }
  const ids = locked.map((s) => s.id);
  await q.query(
    `UPDATE catalog.event_seats SET status = 'sold', order_id = $2, hold_until = NULL, updated_at = now() WHERE id = ANY($1::uuid[])`,
    [ids, orderId],
  );
  const issued = await issueTicketsForOrder(orderId, q as never);
  for (const s of seats) {
    await q.query(`UPDATE tickets.tickets SET holder_name = $3 WHERE order_id = $1 AND event_seat_id = $2`, [orderId, s.seatId, s.holderName]);
  }
  await consumeBlockSeats(q, blockId, ids, 'issued', orderId);
  return { orderId, tickets: issued.length };
}

export interface BlockSummary { id: string; name: string; note: string | null; color: string; total: number; blocked: number; released: number; issued: number; sold: number }
export interface BlockMapSeat { id: string; sector: string; row: string; seat_number: string; x: number | null; y: number | null; status: string; blockId: string | null; color: string | null; blockName: string | null }

export async function blockOverview(q: Q, promoterId: string, eventId: string): Promise<{ blocks: BlockSummary[]; seats: BlockMapSeat[] }> {
  const blocks = await q.query<BlockSummary & Record<string, unknown>>(
    `SELECT b.id, b.name, b.note, b.color,
            count(bs.seat_id)::int AS total,
            count(*) FILTER (WHERE bs.state = 'blocked')::int AS blocked,
            count(*) FILTER (WHERE bs.state = 'released')::int AS released,
            count(*) FILTER (WHERE bs.state = 'issued')::int AS issued,
            count(*) FILTER (WHERE bs.state IN ('sold', 'corporate'))::int AS sold
       FROM catalog.seat_blocks b LEFT JOIN catalog.seat_block_seats bs ON bs.block_id = b.id
      WHERE b.event_id = $1 AND b.promoter_id = $2
      GROUP BY b.id ORDER BY b.created_at`,
    [eventId, promoterId],
  );
  const seats = await q.query<BlockMapSeat & Record<string, unknown>>(
    `SELECT es.id, es.sector, es.row, es.seat_number, es.x_coord AS x, es.y_coord AS y, es.status,
            b.id AS "blockId", b.color, b.name AS "blockName"
       FROM catalog.event_seats es
       LEFT JOIN catalog.seat_block_seats bs ON bs.seat_id = es.id AND bs.state = 'blocked'
       LEFT JOIN catalog.seat_blocks b ON b.id = bs.block_id
      WHERE es.event_id = $1
      ORDER BY es.sector, es.row, es.seat_number`,
    [eventId],
  );
  return { blocks: blocks.rows, seats: seats.rows };
}
