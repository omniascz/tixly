/**
 * Firemní / skupinové objednávky na fakturu (kolo 8 / krok 6).
 *
 * Firemní objednávka = b2b_orders.invoice_orders (firma, IČO, DIČ, adresa, kontakt, splatnost, stav) + objednávka
 * míst orders.orders ('pending', payment_provider 'bank_transfer', order_source 'corporate'), která místa drží až do
 * zaplacení (cron expire-pending-orders ji nebere). Místa z volného prodeje nebo z pojmenované blokace (stav 'corporate').
 *   - cena: kategorie × zóna na serveru (priceSeats); ruční úprava ceny jen s důvodem;
 *   - daňový doklad po sazbách typů vstupenek hned při vytvoření (issueOrderDocument s unpaidDueDate), ISDOC, e-mail;
 *   - zaplacení (datum + reference platby) → objednávka paid, doklad zaplacen, vstupenky; e-mail kontaktu se společným PDF
 *     i každou vstupenkou zvlášť;
 *   - po splatnosti upozornění pořadateli (cron), místa zůstávají držená do ručního uvolnění (= zrušení);
 *   - zrušení: dobropis (opravný daňový doklad), zneplatnění vstupenek, místa zpět (do blokace, odkud přišla, jinak do prodeje).
 */
import { BlockError, consumeBlockSeats, lockSeatsForBlockSale } from '@/lib/theatre/blocks';
import { CategoryRuleError, priceSeats } from '@/lib/theatre/categories';

interface Q { query<R extends Record<string, unknown> = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: R[]; rowCount: number | null }> }

export class CorporateError extends Error {
  constructor(
    public code: 'NOT_FOUND' | 'SEAT_UNAVAILABLE' | 'PRICE_REASON_REQUIRED' | 'BAD_STATE' | 'BAD_DUE_DATE',
    message: string,
    public status = 422,
  ) {
    super(message);
  }
}

export interface CorporateInput {
  eventId: string;
  company: { name: string; ico: string; dic?: string | null; address: string };
  contact: { name: string; email: string; phone?: string | null };
  blockId?: string | null;
  seats: Array<{ seatId: string; categoryId: string; priceMinor?: number }>;
  priceOverrideReason?: string | null;
  dueDate: string; // YYYY-MM-DD
}

export async function createCorporateOrder(
  q: Q,
  ctx: { promoterId: string; userId: string; contactUserId: string },
  input: CorporateInput,
): Promise<{ id: string; orderId: string; invoiceId: string; invoiceNumber: string; totalMinor: number }> {
  const ev = (await q.query<{ currency: string; today: string }>(
    `SELECT currency, (now() AT TIME ZONE 'Europe/Prague')::date::text AS today FROM catalog.events WHERE id = $1 AND promoter_id = $2`,
    [input.eventId, ctx.promoterId],
  )).rows[0];
  if (!ev) throw new CorporateError('NOT_FOUND', 'Termín nenalezen.', 404);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.dueDate) || input.dueDate < ev.today) {
    throw new CorporateError('BAD_DUE_DATE', 'Splatnost musí být dnes nebo později.');
  }
  const seatIds = input.seats.map((s) => s.seatId);

  let seats: Array<{ id: string; ticket_type_id: string }>;
  if (input.blockId) {
    seats = (await lockSeatsForBlockSale(q, ctx, input.eventId, input.blockId, seatIds)) as Array<{ id: string; ticket_type_id: string }>;
  } else {
    seats = (await q.query<{ id: string; ticket_type_id: string }>(
      `SELECT id, ticket_type_id FROM catalog.event_seats
        WHERE event_id = $1 AND id = ANY($2::uuid[]) AND status = 'available' ORDER BY id FOR UPDATE`,
      [input.eventId, seatIds],
    )).rows;
  }
  if (seats.length !== seatIds.length) throw new CorporateError('SEAT_UNAVAILABLE', 'Některé místo už není volné.', 409);

  const priced = await priceSeats(q, input.eventId, seats, input.seats);
  const override = new Map(input.seats.filter((s) => s.priceMinor !== undefined).map((s) => [s.seatId, s.priceMinor as number]));
  const changed = priced.some((p) => override.has(p.seatId) && override.get(p.seatId) !== p.priceMinor);
  if (changed && !input.priceOverrideReason?.trim()) {
    throw new CorporateError('PRICE_REASON_REQUIRED', 'Upravená cena musí mít uvedený důvod.');
  }
  const lines = priced.map((p) => ({ ...p, finalMinor: override.get(p.seatId) ?? p.priceMinor }));
  const total = lines.reduce((a, l) => a + l.finalMinor, 0);

  const orderId = (await q.query<{ id: string }>(
    `INSERT INTO orders.orders
       (user_id, event_id, status, total_amount, currency, locale, payment_provider, order_source,
        buyer_company_name, buyer_vat_number, buyer_phone, expires_at, created_at, updated_at)
     VALUES ($1, $2, 'pending', $3, $4, 'cs', 'bank_transfer', 'corporate', $5, $6, $7, ($8::date + interval '365 days'), now(), now())
     RETURNING id`,
    [ctx.contactUserId, input.eventId, total, ev.currency, input.company.name, input.company.dic ?? null, input.contact.phone ?? null, input.dueDate],
  )).rows[0].id;
  for (const l of lines) {
    await q.query(
      `INSERT INTO orders.order_items (order_id, ticket_type_id, quantity, unit_price, total_price, seat_id, price_category_id, price_category_name)
       VALUES ($1, $2, 1, $3, $3, $4, $5, $6)`,
      [orderId, l.ticketTypeId, l.finalMinor, l.seatId, l.categoryId, l.categoryName],
    );
  }
  await q.query(
    `UPDATE catalog.event_seats SET status = 'sold', order_id = $2, hold_kind = NULL, hold_label = NULL, hold_until = NULL, updated_at = now()
      WHERE id = ANY($1::uuid[])`,
    [seatIds, orderId],
  );
  if (input.blockId) {
    // místa z blokace už kapacitu snížila při blokování
    await consumeBlockSeats(q, input.blockId, seatIds, 'corporate', orderId);
  } else {
    const perType = new Map<string, number>();
    for (const l of lines) perType.set(l.ticketTypeId, (perType.get(l.ticketTypeId) ?? 0) + 1);
    for (const [tt, n] of perType) await q.query(`UPDATE catalog.ticket_types SET remaining_qty = GREATEST(0, remaining_qty - $2) WHERE id = $1`, [tt, n]);
  }

  // daňový doklad po sazbách (číselná řada = systém, vzor /api/admin/invoices)
  const { asSystemInTx } = await import('@/lib/db/rls-pool');
  const { issueOrderDocument } = await import('@/lib/accounting/documents');
  const doc = await asSystemInTx(q as never, () => issueOrderDocument(q as never, orderId, {
    name: input.company.name, email: input.contact.email, address: input.company.address, ico: input.company.ico, dic: input.company.dic ?? null,
  }, { unpaidDueDate: input.dueDate }));
  const inv = (await q.query<{ invoice_number: string; vat_amount_minor: number }>(
    `SELECT invoice_number, vat_amount_minor FROM orders.invoices WHERE id = $1`, [doc.invoiceId],
  )).rows[0];

  const summary = new Map<string, { name: string; quantity: number; totalMinor: number }>();
  for (const l of lines) {
    const k = `${l.ticketTypeId}|${l.categoryName}`;
    const cur = summary.get(k) ?? { name: l.categoryName, quantity: 0, totalMinor: 0 };
    cur.quantity++; cur.totalMinor += l.finalMinor;
    summary.set(k, cur);
  }
  const id = (await q.query<{ id: string }>(
    `INSERT INTO b2b_orders.invoice_orders
       (promoter_id, event_id, company_name, company_ico, company_dic, company_address, contact_name, contact_email, contact_phone,
        invoice_number, ticket_items, total_amount_hellers, vat_amount_hellers, currency, payment_due_days, due_date, status,
        order_id, block_id, invoice_id, price_override_reason, created_by_user_id, confirmed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $13, $14,
             GREATEST(1, LEAST(90, ($15::date - (now() AT TIME ZONE 'Europe/Prague')::date))), $15::date, 'confirmed',
             $16, $17, $18, $19, $20, now())
     RETURNING id`,
    [ctx.promoterId, input.eventId, input.company.name, input.company.ico, input.company.dic ?? null, input.company.address,
      input.contact.name, input.contact.email, input.contact.phone ?? null, inv.invoice_number, JSON.stringify([...summary.values()]),
      total, inv.vat_amount_minor, ev.currency, input.dueDate, orderId, input.blockId ?? null, doc.invoiceId,
      changed ? input.priceOverrideReason!.trim() : null, ctx.userId],
  )).rows[0].id;
  return { id, orderId, invoiceId: doc.invoiceId, invoiceNumber: inv.invoice_number, totalMinor: total };
}

interface CorpRow extends Record<string, unknown> {
  id: string; status: string; order_id: string; block_id: string | null; invoice_id: string | null; total_amount_hellers: number;
  contact_email: string; company_name: string;
}

async function lockCorporate(q: Q, promoterId: string, id: string): Promise<CorpRow> {
  const r = (await q.query<CorpRow>(
    `SELECT id, status, order_id, block_id, invoice_id, total_amount_hellers::int AS total_amount_hellers, contact_email, company_name
       FROM b2b_orders.invoice_orders WHERE id = $1 AND promoter_id = $2 FOR UPDATE`,
    [id, promoterId],
  )).rows[0];
  if (!r) throw new CorporateError('NOT_FOUND', 'Firemní objednávka nenalezena.', 404);
  return r;
}

/** Zaplaceno (datum + reference platby) → objednávka paid, doklad zaplacen, vstupenky. */
export async function markCorporatePaid(
  q: Q, promoterId: string, id: string, input: { paidOn: string; paymentReference: string },
): Promise<{ orderId: string; contactEmail: string; tickets: number }> {
  const c = await lockCorporate(q, promoterId, id);
  if (!['confirmed', 'proforma_sent', 'overdue'].includes(c.status)) {
    throw new CorporateError('BAD_STATE', `Objednávku ve stavu „${c.status}" nelze označit jako zaplacenou.`, 409);
  }
  const paidAt = `${input.paidOn}T12:00:00+02:00`;
  await q.query(`UPDATE orders.orders SET status = 'paid', paid_at = $2::timestamptz, updated_at = now() WHERE id = $1 AND status = 'pending'`, [c.order_id, paidAt]);
  if (c.invoice_id) {
    const { asSystemInTx } = await import('@/lib/db/rls-pool');
    await asSystemInTx(q as never, () => q.query(`UPDATE orders.invoices SET paid_at = $2::timestamptz WHERE id = $1`, [c.invoice_id, paidAt]));
  }
  const { issueTicketsForOrder } = await import('@/lib/tickets/demo-issuer');
  const issued = await issueTicketsForOrder(c.order_id, q as never);
  await q.query(
    `UPDATE b2b_orders.invoice_orders SET status = 'paid', paid_at = $2::timestamptz, payment_reference = $3, updated_at = now() WHERE id = $1`,
    [id, paidAt, input.paymentReference],
  );
  return { orderId: c.order_id, contactEmail: c.contact_email, tickets: issued.length };
}

/** Zrušení: dobropis, zneplatnění vstupenek, místa zpět (do blokace, odkud přišla, jinak do prodeje). */
export async function cancelCorporateOrder(q: Q, promoterId: string, id: string, reason: string): Promise<{ creditNoteId: string | null; seatsReturned: number }> {
  const c = await lockCorporate(q, promoterId, id);
  if (c.status === 'cancelled') throw new CorporateError('BAD_STATE', 'Objednávka už je zrušená.', 409);
  const { asSystemInTx } = await import('@/lib/db/rls-pool');
  const { issueCreditNoteForRefund } = await import('@/lib/accounting/documents');
  const creditNoteId = c.invoice_id
    ? await asSystemInTx(q as never, () => issueCreditNoteForRefund(q as never, c.order_id, c.total_amount_hellers))
    : null;
  await q.query(`UPDATE tickets.tickets SET status = 'revoked', revoked_at = now() WHERE order_id = $1 AND status <> 'revoked'`, [c.order_id]);

  const blockSeats = (await q.query<{ seat_id: string; name: string }>(
    `SELECT bs.seat_id, b.name FROM catalog.seat_block_seats bs JOIN catalog.seat_blocks b ON b.id = bs.block_id
      WHERE bs.order_id = $1 AND bs.state = 'corporate'`,
    [c.order_id],
  )).rows;
  for (const s of blockSeats) {
    await q.query(
      `UPDATE catalog.event_seats SET status = 'blocked', hold_kind = 'block', hold_label = $2, order_id = NULL, ticket_id = NULL, updated_at = now() WHERE id = $1`,
      [s.seat_id, s.name],
    );
  }
  await q.query(`UPDATE catalog.seat_block_seats SET state = 'blocked', order_id = NULL, updated_at = now() WHERE order_id = $1 AND state = 'corporate'`, [c.order_id]);
  const freed = await q.query<{ ticket_type_id: string }>(
    `UPDATE catalog.event_seats SET status = 'available', order_id = NULL, ticket_id = NULL, updated_at = now()
      WHERE order_id = $1 AND NOT (id = ANY($2::uuid[])) RETURNING ticket_type_id`,
    [c.order_id, blockSeats.map((s) => s.seat_id)],
  );
  const perType = new Map<string, number>();
  for (const s of freed.rows) perType.set(s.ticket_type_id, (perType.get(s.ticket_type_id) ?? 0) + 1);
  for (const [tt, n] of perType) {
    await q.query(`UPDATE catalog.ticket_types SET remaining_qty = LEAST(total_qty, remaining_qty + $2) WHERE id = $1`, [tt, n]);
  }
  await q.query(
    `UPDATE orders.orders SET status = 'cancelled', cancellation_reason = $2, updated_at = now() WHERE id = $1`,
    [c.order_id, reason],
  );
  await q.query(
    `UPDATE b2b_orders.invoice_orders SET status = 'cancelled', cancelled_at = now(), cancel_reason = $2, credit_note_id = $3, updated_at = now() WHERE id = $1`,
    [id, reason, creditNoteId],
  );
  return { creditNoteId, seatsReturned: blockSeats.length + freed.rows.length };
}

/** E-mail kontaktu: faktura (PDF + ISDOC) k firemní objednávce. */
export async function sendCorporateInvoiceMail(q: Q, invoiceId: string, to: string): Promise<void> {
  const { loadTaxDocument } = await import('@/lib/accounting/documents');
  const { buildInvoicePdf } = await import('@/lib/accounting/invoice-pdf');
  const { buildIsdocXml } = await import('@/lib/accounting/isdoc');
  const { sendMail } = await import('@/lib/email/mailer');
  const { escapeHtml } = await import('@/lib/html-escape/escape');
  const doc = await loadTaxDocument(q as never, invoiceId);
  if (!doc) throw new CorporateError('NOT_FOUND', 'Doklad nenalezen.', 404);
  const pdf = await buildInvoicePdf(doc);
  const total = `${(doc.totalMinor / 100).toLocaleString('cs-CZ')} ${doc.currency}`;
  await sendMail({
    to,
    subject: `Faktura ${doc.number} — ${doc.supplier.name}`,
    html: `<!DOCTYPE html><html><body style="font-family:system-ui;max-width:600px;padding:24px">
      <p>Dobrý den,</p><p>v příloze posíláme fakturu <strong>${escapeHtml(doc.number)}</strong> na vstupenky ve výši <strong>${escapeHtml(total)}</strong>
      se splatností <strong>${escapeHtml(doc.dueDate)}</strong>. Vstupenky zašleme po připsání platby.</p>
      <p>${escapeHtml(doc.supplier.name)}</p></body></html>`,
    attachments: [
      { filename: `faktura-${doc.number}.pdf`, content: pdf, contentType: 'application/pdf' },
      { filename: `faktura-${doc.number}.isdoc`, content: Buffer.from(buildIsdocXml(doc), 'utf8'), contentType: 'application/xml' },
    ],
  });
}

export { BlockError, CategoryRuleError };
