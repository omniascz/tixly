/**
 * Zápis platby na pokladně (kolo 8 / krok 5) do existující evidence pokladny:
 * orders.box_office_sessions (směna pokladníka na termínu, součty hotovost/karta) a orders.box_office_sales
 * (prodej se způsobem platby cash | card a číslem dokladu). Směnu pokladníka na termínu použije otevřenou,
 * jinak ji otevře. Volá se v transakci volajícího (rezervace na pokladně, prodej na pokladně POS).
 */
interface Q { query<R extends Record<string, unknown> = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: R[]; rowCount: number | null }> }

export type BoxOfficePaymentType = 'cash' | 'card';

export interface BoxOfficeLine { ticketTypeId: string | null; name: string; quantity: number; unitMinor: number; totalMinor: number }

export async function recordBoxOfficePayment(q: Q, input: {
  eventId: string;
  cashierUserId: string;
  orderId: string;
  paymentType: BoxOfficePaymentType;
  lines: BoxOfficeLine[];
  receiptNumber: string;
  cashTenderedMinor?: number | null;
}): Promise<{ sessionId: string; changeMinor: number }> {
  let sessionId = (await q.query<{ id: string }>(
    `SELECT id FROM orders.box_office_sessions
      WHERE event_id = $1 AND cashier_user_id = $2 AND status = 'open'
      ORDER BY opened_at DESC LIMIT 1 FOR UPDATE`,
    [input.eventId, input.cashierUserId],
  )).rows[0]?.id;
  if (!sessionId) {
    sessionId = (await q.query<{ id: string }>(
      `INSERT INTO orders.box_office_sessions (event_id, cashier_user_id) VALUES ($1, $2) RETURNING id`,
      [input.eventId, input.cashierUserId],
    )).rows[0].id;
  }
  const total = input.lines.reduce((a, l) => a + l.totalMinor, 0);
  const changeMinor = input.paymentType === 'cash' && input.cashTenderedMinor ? Math.max(0, input.cashTenderedMinor - total) : 0;
  let first = true;
  for (const l of input.lines) {
    // číslo dokladu je unikátní — nese ho první řádek prodeje, další řádky téže objednávky jsou bez čísla
    await q.query(
      `INSERT INTO orders.box_office_sales
         (session_id, order_id, ticket_type_id, ticket_type_name, quantity, unit_price_halire, total_halire,
          payment_type, cash_tendered_halire, change_halire, receipt_number)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [sessionId, input.orderId, l.ticketTypeId, l.name, l.quantity, l.unitMinor, l.totalMinor, input.paymentType,
        first ? input.cashTenderedMinor ?? null : null, first ? changeMinor : 0, first ? input.receiptNumber : null],
    );
    first = false;
  }
  const qty = input.lines.reduce((a, l) => a + l.quantity, 0);
  await q.query(
    `UPDATE orders.box_office_sessions
        SET cash_in_halire = cash_in_halire + CASE WHEN $2 = 'cash' THEN $3 ELSE 0 END,
            card_in_halire = card_in_halire + CASE WHEN $2 = 'card' THEN $3 ELSE 0 END,
            tickets_sold = tickets_sold + $4
      WHERE id = $1`,
    [sessionId, input.paymentType, total, qty],
  );
  await q.query(
    `UPDATE orders.orders SET is_box_office = true, box_office_session_id = $2, updated_at = now() WHERE id = $1`,
    [input.orderId, sessionId],
  );
  return { sessionId, changeMinor };
}

/** Řádky prodeje z položek objednávky (seskupené po typu vstupenky, kategorii a ceně) + servisní poplatek. */
export async function orderLines(q: Q, orderId: string): Promise<BoxOfficeLine[]> {
  const lines: BoxOfficeLine[] = (await q.query<{ ticket_type_id: string; name: string; quantity: number; unit: number; total: number }>(
    `SELECT oi.ticket_type_id, tt.name || COALESCE(' — ' || oi.price_category_name, '') AS name,
            SUM(oi.quantity)::int AS quantity, oi.unit_price AS unit, SUM(oi.total_price)::int AS total
       FROM orders.order_items oi JOIN catalog.ticket_types tt ON tt.id = oi.ticket_type_id
      WHERE oi.order_id = $1
      GROUP BY oi.ticket_type_id, tt.name, oi.price_category_name, oi.unit_price
      ORDER BY 2`,
    [orderId],
  )).rows.map((r) => ({ ticketTypeId: r.ticket_type_id, name: r.name, quantity: r.quantity, unitMinor: r.unit, totalMinor: r.total }));
  const fee = (await q.query<{ fee: number }>(
    `SELECT COALESCE(service_fee_minor, 0)::int AS fee FROM orders.orders WHERE id = $1`, [orderId],
  )).rows[0]?.fee ?? 0;
  if (fee > 0) lines.push({ ticketTypeId: null, name: 'Servisní poplatek', quantity: 1, unitMinor: fee, totalMinor: fee });
  return lines;
}
