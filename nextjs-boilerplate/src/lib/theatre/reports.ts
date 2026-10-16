/**
 * Divadelní reporty za termín, inscenaci a období (kolo 8 / krok 8).
 *
 *   - prodáno a tržby podle zóny (typ vstupenky), kategorie a kanálu: online | pokladna | rezervace | firemní | volné;
 *   - obsazenost sálu v % (prodaná + aktivně rezervovaná místa / prodejná místa; neprodejná místa se nepočítají);
 *   - využití blokací (místa celkem | uvolněno | vydáno | prodáno | zbývá), propadlé a zrušené rezervace;
 *   - seznam pro uvaděče: sál, řada, místo, kategorie, jméno, ověřit průkaz.
 * Kanál objednávky: firemní (b2b_orders.invoice_orders) > rezervace (orders.seat_reservations) > volné (comp / 0 Kč bez
 * platby) > pokladna (is_box_office / box_office / walkin) > online. Tržba = cena položek po slevě (bez servisního poplatku).
 */
interface Q { query<R extends Record<string, unknown> = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: R[]; rowCount: number | null }> }

export type Scope = { kind: 'term'; eventId: string } | { kind: 'production'; productionId: string } | { kind: 'period'; from: string; to: string };

export const CHANNEL_LABEL: Record<string, string> = { online: 'online', box_office: 'pokladna', reservation: 'rezervace', corporate: 'firemní', comps: 'volné' };

export interface SalesRow { eventId: string; title: string; dateStart: string; zone: string; category: string; channel: string; sold: number; revenueMinor: number }
export interface OccupancyRow { eventId: string; title: string; dateStart: string; city: string | null; hall: string | null; sellable: number; sold: number; reserved: number; blocked: number; occupiedPct: number }
export interface BlockRow { eventId: string; title: string; block: string; total: number; released: number; issued: number; sold: number; remaining: number }
export interface ReservationRow { eventId: string; title: string; active: number; paid: number; expired: number; cancelled: number; expiredSeats: number }
export interface TheatreReport { scope: Scope; events: number; sales: SalesRow[]; occupancy: OccupancyRow[]; blocks: BlockRow[]; reservations: ReservationRow[]; totals: { sold: number; revenueMinor: number; offlineDuplicates: number } }

async function scopeEvents(q: Q, promoterId: string, scope: Scope): Promise<string[]> {
  const r = scope.kind === 'term'
    ? await q.query<{ id: string }>(`SELECT id FROM catalog.events WHERE id = $1 AND promoter_id = $2`, [scope.eventId, promoterId])
    : scope.kind === 'production'
      ? await q.query<{ id: string }>(`SELECT id FROM catalog.events WHERE production_id = $1 AND promoter_id = $2`, [scope.productionId, promoterId])
      : await q.query<{ id: string }>(
          `SELECT id FROM catalog.events WHERE promoter_id = $1
              AND (date_start AT TIME ZONE 'Europe/Prague')::date BETWEEN $2::date AND $3::date`,
          [promoterId, scope.from, scope.to],
        );
  return r.rows.map((x) => x.id);
}

export async function theatreReport(q: Q, promoterId: string, scope: Scope): Promise<TheatreReport> {
  const ids = await scopeEvents(q, promoterId, scope);
  if (ids.length === 0) return { scope, events: 0, sales: [], occupancy: [], blocks: [], reservations: [], totals: { sold: 0, revenueMinor: 0, offlineDuplicates: 0 } };

  const sales = (await q.query<SalesRow & Record<string, unknown>>(
    `WITH o AS (
       SELECT o.id, o.event_id,
              CASE WHEN EXISTS (SELECT 1 FROM b2b_orders.invoice_orders io WHERE io.order_id = o.id) THEN 'corporate'
                   WHEN EXISTS (SELECT 1 FROM orders.seat_reservations r WHERE r.order_id = o.id) THEN 'reservation'
                   WHEN o.payment_provider = 'comp' OR o.comp_type IS NOT NULL OR (o.total_amount = 0 AND o.payment_provider IN ('free', 'comp')) THEN 'comps'
                   WHEN o.is_box_office OR o.payment_provider IN ('box_office', 'walkin') THEN 'box_office'
                   ELSE 'online' END AS channel
         FROM orders.orders o
        WHERE o.event_id = ANY($1::uuid[]) AND o.status IN ('paid', 'paid_partial'))
     SELECT e.id AS "eventId", e.title, e.date_start::text AS "dateStart",
            COALESCE(tt.zone, tt.name) AS zone, COALESCE(oi.price_category_name, 'Plné') AS category, o.channel,
            SUM(oi.quantity)::int AS sold, SUM(oi.total_price)::int AS "revenueMinor"
       FROM o JOIN orders.order_items oi ON oi.order_id = o.id
       JOIN catalog.ticket_types tt ON tt.id = oi.ticket_type_id
       JOIN catalog.events e ON e.id = o.event_id
      GROUP BY e.id, e.title, e.date_start, COALESCE(tt.zone, tt.name), COALESCE(oi.price_category_name, 'Plné'), o.channel
      ORDER BY e.date_start, zone, category, o.channel`,
    [ids],
  )).rows;

  const occupancy = (await q.query<OccupancyRow & Record<string, unknown>>(
    `SELECT e.id AS "eventId", e.title, e.date_start::text AS "dateStart", v.city, v.name AS hall,
            COUNT(es.id) FILTER (WHERE COALESCE(es.seat_type, 'standard') <> 'unsellable')::int AS sellable,
            COUNT(es.id) FILTER (WHERE es.status = 'sold' AND NOT EXISTS (
              SELECT 1 FROM orders.seat_reservations r WHERE r.order_id = es.order_id AND r.status = 'active'))::int AS sold,
            COUNT(es.id) FILTER (WHERE es.status = 'sold' AND EXISTS (
              SELECT 1 FROM orders.seat_reservations r WHERE r.order_id = es.order_id AND r.status = 'active'))::int AS reserved,
            COUNT(es.id) FILTER (WHERE es.status = 'blocked' AND COALESCE(es.seat_type, 'standard') <> 'unsellable')::int AS blocked
       FROM catalog.events e
       LEFT JOIN catalog.venues v ON v.id = e.venue_id
       LEFT JOIN catalog.event_seats es ON es.event_id = e.id
      WHERE e.id = ANY($1::uuid[])
      GROUP BY e.id, e.title, e.date_start, v.city, v.name
      ORDER BY e.date_start`,
    [ids],
  )).rows.map((r) => ({ ...r, occupiedPct: r.sellable ? Math.round(((r.sold + r.reserved) / r.sellable) * 1000) / 10 : 0 }));

  const blocks = (await q.query<BlockRow & Record<string, unknown>>(
    `SELECT e.id AS "eventId", e.title, b.name AS block,
            COUNT(bs.seat_id)::int AS total,
            COUNT(*) FILTER (WHERE bs.state = 'released')::int AS released,
            COUNT(*) FILTER (WHERE bs.state = 'issued')::int AS issued,
            COUNT(*) FILTER (WHERE bs.state IN ('sold', 'corporate'))::int AS sold,
            COUNT(*) FILTER (WHERE bs.state = 'blocked')::int AS remaining
       FROM catalog.seat_blocks b JOIN catalog.events e ON e.id = b.event_id
       LEFT JOIN catalog.seat_block_seats bs ON bs.block_id = b.id
      WHERE b.event_id = ANY($1::uuid[])
      GROUP BY e.id, e.title, e.date_start, b.id, b.name, b.created_at
      ORDER BY e.date_start, b.created_at`,
    [ids],
  )).rows;

  const reservations = (await q.query<ReservationRow & Record<string, unknown>>(
    `SELECT e.id AS "eventId", e.title,
            COUNT(r.id) FILTER (WHERE r.status = 'active')::int AS active,
            COUNT(r.id) FILTER (WHERE r.status = 'paid')::int AS paid,
            COUNT(r.id) FILTER (WHERE r.status = 'expired')::int AS expired,
            COUNT(r.id) FILTER (WHERE r.status = 'cancelled')::int AS cancelled,
            COALESCE(SUM(r.seat_count) FILTER (WHERE r.status = 'expired'), 0)::int AS "expiredSeats"
       FROM catalog.events e LEFT JOIN orders.seat_reservations r ON r.event_id = e.id
      WHERE e.id = ANY($1::uuid[])
      GROUP BY e.id, e.title, e.date_start ORDER BY e.date_start`,
    [ids],
  )).rows;

  // Kolo 14: druhé (a další) offline odbavení téže vstupenky jiným skenerem — po synchronizaci 'duplicate' (C-50)
  const offlineDuplicates = (await q.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM tickets.scan_logs WHERE event_id = ANY($1::uuid[]) AND offline AND scan_result = 'duplicate'`,
    [ids],
  )).rows[0]?.n ?? 0;

  return {
    scope, events: ids.length, sales, occupancy, blocks, reservations,
    totals: { sold: sales.reduce((a, s) => a + s.sold, 0), revenueMinor: sales.reduce((a, s) => a + s.revenueMinor, 0), offlineDuplicates },
  };
}

export interface UsherRow { hall: string | null; sector: string | null; row: string | null; seat: string | null; category: string | null; name: string | null; verifyId: string | null; ticketStatus: string }

/** Seznam pro uvaděče: platné vstupenky termínu po místech (sál, řada, místo, kategorie, jméno, ověřit průkaz). */
export async function usherList(q: Q, promoterId: string, eventId: string): Promise<{ title: string; dateStart: string; hall: string | null; rows: UsherRow[] } | null> {
  const ev = (await q.query<{ title: string; date_start: string; hall: string | null }>(
    `SELECT e.title, e.date_start::text, v.name AS hall FROM catalog.events e LEFT JOIN catalog.venues v ON v.id = e.venue_id
      WHERE e.id = $1 AND e.promoter_id = $2`,
    [eventId, promoterId],
  )).rows[0];
  if (!ev) return null;
  const rows = (await q.query<UsherRow & Record<string, unknown>>(
    `SELECT $2::text AS hall, es.sector, es.row, es.seat_number AS seat, t.price_category_name AS category,
            COALESCE(NULLIF(t.holder_name, ''), NULLIF(concat_ws(' ', t.holder_first_name, t.holder_last_name), ''), io.company_name, u.name) AS name,
            t.proof_required_label AS "verifyId", t.status AS "ticketStatus"
       FROM tickets.tickets t
       JOIN catalog.ticket_types tt ON tt.id = t.ticket_type_id
       LEFT JOIN catalog.event_seats es ON es.id = t.event_seat_id
       JOIN orders.orders o ON o.id = t.order_id
       LEFT JOIN identity.users u ON u.id = o.user_id
       LEFT JOIN b2b_orders.invoice_orders io ON io.order_id = o.id
      WHERE tt.event_id = $1 AND t.status IN ('valid', 'used')
      ORDER BY es.sector NULLS LAST, NULLIF(regexp_replace(es.row, '[^0-9]', '', 'g'), '')::int NULLS LAST, es.row,
               NULLIF(regexp_replace(es.seat_number, '[^0-9]', '', 'g'), '')::int NULLS LAST, es.seat_number`,
    [eventId, ev.hall],
  )).rows;
  return { title: ev.title, dateStart: ev.date_start, hall: ev.hall, rows };
}
