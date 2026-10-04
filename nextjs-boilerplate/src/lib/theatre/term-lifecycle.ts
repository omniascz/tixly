/**
 * Zrušení a přesun termínu (kolo 8 / krok 7, C-14).
 *
 * Zrušení:
 *   1. (transakce) termín → 'cancelled' + důvod, rezervace vypnuté; rozpracované nákupy (pending) zrušené a místa
 *      vrácená — platba, která dorazí později, se vrátí automaticky (gopay webhook: late payment na 'cancelled');
 *      aktivní rezervace na pokladně zrušené; nezaplacené firemní objednávky zrušené dobropisem;
 *   2. online zaplacené objednávky vrácené přes bránu (sdílená cesta s hromadným refundem; dobropis k dokladu);
 *   3. všechny zbývající vstupenky termínu zneplatněné (pokladna, volné, firemní) — issuer na zrušený termín nevydá;
 *   4. e-mail kupcům; pořadateli seznam k ručnímu vrácení (platby na pokladně, firemní faktury, selhané refundy).
 * Přesun:
 *   termín dostane nové datum (vstupenky platí), kupci e-mail s novým datem a odkazem na vrácení s lhůtou
 *   (výchozí 14 dní) — žádost jde existující cestou refundu (/api/reschedule/[token]).
 */
import { escapeHtml } from '@/lib/html-escape/escape';
import { GATEWAY_REFUND_PROVIDERS, refundOrderFully } from '@/lib/orders/refund-full-order';
import { releaseOrderCapacity } from '@/lib/orders/release-capacity';

interface Q { query<R extends Record<string, unknown> = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: R[]; rowCount: number | null }> }
interface TxClient extends Q { release(): void }
interface Pool { connect(): Promise<TxClient>; query: Q['query'] }

export class TermError extends Error {
  constructor(public code: 'NOT_FOUND' | 'ALREADY_CANCELLED' | 'BAD_DATE', message: string, public status = 422) {
    super(message);
  }
}

export interface ManualRefund {
  orderId: string; channel: 'box_office' | 'corporate' | 'gateway_failed' | 'other'; buyer: string | null; email: string | null;
  amountMinor: number; currency: string; paymentType: string | null; invoiceNumber: string | null; note: string | null;
}

export interface CancelSummary {
  pendingCancelled: number; reservationsCancelled: number; corporateCancelled: number;
  refunded: number; refundFailed: number; ticketsRevoked: number; buyersEmailed: number; manualRefunds: ManualRefund[];
}

/** Platby, které musí pořadatel vrátit ručně (pokladna, firemní faktury, selhané / nepodporované refundy). */
export async function manualRefundList(q: Q, eventId: string): Promise<ManualRefund[]> {
  return (await q.query<ManualRefund & Record<string, unknown>>(
    `SELECT o.id AS "orderId",
            CASE WHEN io.id IS NOT NULL THEN 'corporate'
                 WHEN o.payment_provider IN ('box_office', 'walkin') OR o.is_box_office THEN 'box_office'
                 WHEN o.status = 'refund_failed' THEN 'gateway_failed'
                 ELSE 'other' END AS channel,
            COALESCE(io.company_name, u.name) AS buyer, COALESCE(io.contact_email, u.email) AS email,
            o.total_amount AS "amountMinor", o.currency,
            (SELECT s.payment_type FROM orders.box_office_sales s WHERE s.order_id = o.id AND s.receipt_number IS NOT NULL LIMIT 1) AS "paymentType",
            (SELECT i.invoice_number FROM orders.invoices i WHERE i.order_id = o.id AND i.doc_type = 'invoice' LIMIT 1) AS "invoiceNumber",
            o.refund_error AS note
       FROM orders.orders o
       LEFT JOIN identity.users u ON u.id = o.user_id
       LEFT JOIN b2b_orders.invoice_orders io ON io.order_id = o.id
      WHERE o.event_id = $1 AND o.total_amount > 0
        AND (o.status = 'refund_failed'
             OR (o.status IN ('paid', 'paid_partial') AND (o.payment_provider IS NULL OR NOT (o.payment_provider = ANY($2::text[])))))
      ORDER BY channel, buyer`,
    [eventId, GATEWAY_REFUND_PROVIDERS],
  )).rows;
}

export async function cancelTerm(
  pool: Pool, ctx: { promoterId: string; userId: string }, eventId: string, reason: string,
): Promise<CancelSummary> {
  const client = await pool.connect();
  let pendingCancelled = 0;
  let reservations: Array<{ order_id: string; code: string; buyer_email: string; buyer_name: string; expires_at: Date }> = [];
  let corporateCancelled = 0;
  try {
    await client.query('BEGIN');
    const ev = (await client.query<{ status: string }>(
      `SELECT status FROM catalog.events WHERE id = $1 AND promoter_id = $2 FOR UPDATE`, [eventId, ctx.promoterId],
    )).rows[0];
    if (!ev) throw new TermError('NOT_FOUND', 'Termín nenalezen.', 404);
    if (ev.status === 'cancelled') throw new TermError('ALREADY_CANCELLED', 'Termín už je zrušený.', 409);
    await client.query(
      `UPDATE catalog.events SET status = 'cancelled', cancelled_at = now(), cancellation_reason = $2, reservations_enabled = false, updated_at = now()
        WHERE id = $1`,
      [eventId, reason],
    );
    // aktivní rezervace na pokladně
    reservations = (await client.query<{ order_id: string; code: string; buyer_email: string; buyer_name: string; expires_at: Date }>(
      `UPDATE orders.seat_reservations SET status = 'cancelled', closed_at = now(), updated_at = now()
        WHERE event_id = $1 AND status = 'active' RETURNING order_id, code, buyer_email, buyer_name, expires_at`,
      [eventId],
    )).rows;
    // nezaplacené firemní objednávky → dobropis + místa
    const corp = (await client.query<{ id: string }>(
      `SELECT id FROM b2b_orders.invoice_orders WHERE event_id = $1 AND status IN ('confirmed', 'proforma_sent', 'overdue', 'draft') AND order_id IS NOT NULL`,
      [eventId],
    )).rows;
    const { cancelCorporateOrder } = await import('@/lib/theatre/corporate');
    for (const c of corp) await cancelCorporateOrder(client, ctx.promoterId, c.id, `Termín zrušen: ${reason}`);
    corporateCancelled = corp.length;
    // rozpracované nákupy (vč. rezervací výše)
    const pending = (await client.query<{ id: string }>(
      `SELECT id FROM orders.orders WHERE event_id = $1 AND status = 'pending' FOR UPDATE`, [eventId],
    )).rows.map((r) => r.id);
    if (pending.length) {
      await client.query(
        `UPDATE orders.orders SET status = 'cancelled', cancellation_reason = $2, updated_at = now() WHERE id = ANY($1::uuid[])`,
        [pending, `Termín zrušen: ${reason}`],
      );
      await releaseOrderCapacity(client as never, pending);
    }
    pendingCancelled = pending.length;
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }

  // online platby zpět přes bránu (mimo transakci — síť)
  const online = (await pool.query<{ id: string; status: string }>(
    `SELECT id, status FROM orders.orders WHERE event_id = $1 AND status IN ('paid', 'paid_partial') AND total_amount > 0
        AND payment_provider = ANY($2::text[]) AND NOT EXISTS (SELECT 1 FROM b2b_orders.invoice_orders io WHERE io.order_id = orders.orders.id)`,
    [eventId, GATEWAY_REFUND_PROVIDERS],
  )).rows;
  let refunded = 0;
  let refundFailed = 0;
  for (const o of online) {
    const r = await refundOrderFully(o.id, { actorUserId: ctx.userId, kind: 'term_cancelled', reason, previousStatus: o.status }).catch((e: unknown) => {
      console.error('[cancel-term] refund', o.id, e);
      return null;
    });
    if (r && (r.outcome === 'refunded' || r.outcome === 'already')) refunded++;
    else refundFailed++;
  }

  // zbývající vstupenky termínu (pokladna, volné, firemní, rezervace) zneplatnit
  const revoked = await pool.query(
    `UPDATE tickets.tickets SET status = 'revoked', revoked_at = now(), updated_at = now()
      WHERE ticket_type_id IN (SELECT id FROM catalog.ticket_types WHERE event_id = $1) AND status IN ('valid', 'transferred', 'resale_listed')`,
    [eventId],
  );

  const manualRefunds = await manualRefundList(pool, eventId);
  const buyersEmailed = await mailCancellation(pool, eventId, reason, reservations);
  return {
    pendingCancelled, reservationsCancelled: reservations.length, corporateCancelled, refunded, refundFailed,
    ticketsRevoked: (revoked.rowCount ?? 0), buyersEmailed, manualRefunds,
  };
}

async function eventHead(q: Q, eventId: string): Promise<{ title: string; date: string; venue: string | null; promoter: string }> {
  const e = (await q.query<{ title: string; date_start: Date; venue: string | null; promoter: string }>(
    `SELECT e.title, e.date_start, v.name AS venue, p.name AS promoter
       FROM catalog.events e LEFT JOIN catalog.venues v ON v.id = e.venue_id JOIN platform.promoters p ON p.id = e.promoter_id
      WHERE e.id = $1`,
    [eventId],
  )).rows[0];
  return { title: e.title, date: fmt(e.date_start), venue: e.venue, promoter: e.promoter };
}
const fmt = (d: Date | string): string => new Date(d).toLocaleString('cs-CZ', { timeZone: 'Europe/Prague', dateStyle: 'long', timeStyle: 'short' });
const page = (body: string): string => `<!DOCTYPE html><html><body style="font-family:system-ui;max-width:600px;padding:24px">${body}</body></html>`;

async function mailCancellation(
  q: Q, eventId: string, reason: string, reservations: Array<{ code: string; buyer_email: string; buyer_name: string }>,
): Promise<number> {
  const { sendMail } = await import('@/lib/email/mailer');
  const h = await eventHead(q, eventId);
  const buyers = (await q.query<{ email: string; name: string | null; status: string; provider: string | null; corporate: boolean; total: number; currency: string }>(
    `SELECT DISTINCT ON (lower(COALESCE(io.contact_email, u.email)), o.id)
            COALESCE(io.contact_email, u.email) AS email, COALESCE(io.contact_name, u.name) AS name, o.status, o.payment_provider AS provider,
            io.id IS NOT NULL AS corporate, o.total_amount AS total, o.currency
       FROM orders.orders o JOIN identity.users u ON u.id = o.user_id
       LEFT JOIN b2b_orders.invoice_orders io ON io.order_id = o.id
      WHERE o.event_id = $1 AND o.status IN ('paid', 'paid_partial', 'refunded', 'refund_failed', 'refund_pending')
        AND u.anonymized_at IS NULL AND COALESCE(io.contact_email, u.email) NOT LIKE '%.local'`,
    [eventId],
  )).rows;
  let sent = 0;
  const head = `<p><strong>${escapeHtml(h.title)}</strong><br>${escapeHtml(h.date)}${h.venue ? `, ${escapeHtml(h.venue)}` : ''}</p>`;
  for (const b of buyers) {
    const money = `${(b.total / 100).toLocaleString('cs-CZ')} ${b.currency}`;
    const refundText = b.status === 'refunded'
      ? `Částku <strong>${money}</strong> jsme vám vrátili stejnou platební metodou; opravný daňový doklad vystavíme, pokud jste měli doklad.`
      : b.corporate
        ? 'Vrácení platby za fakturu s vámi vyřeší pořadatel (opravný daňový doklad).'
        : b.total > 0 ? `Vrácení <strong>${money}</strong> s vámi vyřeší pořadatel (platba na pokladně).` : '';
    try {
      await sendMail({
        to: b.email,
        subject: `Zrušeno: ${h.title} (${h.date})`,
        html: page(`<p>Dobrý den${b.name ? ` ${escapeHtml(b.name)}` : ''},</p><p>s lítostí oznamujeme, že představení je <strong>zrušeno</strong>.</p>${head}
          <p>Důvod: ${escapeHtml(reason)}</p><p>Vstupenky jsou neplatné. ${refundText}</p><p>${escapeHtml(h.promoter)}</p>`),
      });
      sent++;
    } catch (e) { console.error('[cancel-term] mail', b.email, e); }
  }
  for (const r of reservations) {
    try {
      await sendMail({
        to: r.buyer_email,
        subject: `Zrušeno: ${h.title} — rezervace ${r.code} propadá`,
        html: page(`<p>Dobrý den ${escapeHtml(r.buyer_name)},</p><p>představení je <strong>zrušeno</strong> a vaše rezervace <strong>${r.code}</strong> proto propadá. Nic jste neplatili.</p>${head}<p>Důvod: ${escapeHtml(reason)}</p>`),
      });
      sent++;
    } catch (e) { console.error('[cancel-term] mail rezervace', r.code, e); }
  }
  return sent;
}

/** Přesun termínu: nové datum, vstupenky platí, e-mail s odkazem na vrácení s lhůtou. */
export async function postponeTerm(
  pool: Pool, ctx: { promoterId: string; userId: string }, eventId: string,
  input: { newStart: string; reason: string; refundDays?: number },
): Promise<{ rescheduleId: string; recipients: number; responseDeadline: string; emailed: number }> {
  const newStart = new Date(input.newStart);
  if (Number.isNaN(newStart.getTime()) || newStart.getTime() <= Date.now()) throw new TermError('BAD_DATE', 'Nové datum musí být v budoucnosti.');
  const days = input.refundDays ?? 14;
  const client = await pool.connect();
  let rescheduleId = '';
  let deadline = '';
  let recipients: Array<{ token: string; email: string; name: string | null }> = [];
  let oldDate = '';
  try {
    await client.query('BEGIN');
    const ev = (await client.query<{ status: string; date_start: Date }>(
      `SELECT status, date_start FROM catalog.events WHERE id = $1 AND promoter_id = $2 FOR UPDATE`, [eventId, ctx.promoterId],
    )).rows[0];
    if (!ev) throw new TermError('NOT_FOUND', 'Termín nenalezen.', 404);
    if (ev.status === 'cancelled') throw new TermError('ALREADY_CANCELLED', 'Zrušený termín nelze přesunout.', 409);
    oldDate = fmt(ev.date_start);
    // délka představení se zachová (date_end posuneme o stejný rozdíl)
    await client.query(
      `UPDATE catalog.events
          SET postponed_at = now(), postponed_reason = $2, original_date_start = COALESCE(original_date_start, date_start),
              rescheduled_to_date = $3::timestamptz,
              date_end = CASE WHEN date_end IS NOT NULL THEN date_end + ($3::timestamptz - date_start) END,
              date_start = $3::timestamptz, updated_at = now()
        WHERE id = $1`,
      [eventId, input.reason, newStart.toISOString()],
    );
    const ins = (await client.query<{ id: string; response_deadline: Date }>(
      `INSERT INTO catalog.event_reschedules (original_event_id, new_event_id, promoter_id, reason, offer_refund, response_deadline, sent_at)
       VALUES ($1, NULL, $2, $3, true, now() + ($4 || ' days')::interval, now()) RETURNING id, response_deadline`,
      [eventId, ctx.promoterId, input.reason, String(days)],
    )).rows[0];
    rescheduleId = ins.id;
    deadline = new Date(ins.response_deadline).toISOString();
    recipients = (await client.query<{ token: string; email: string; name: string | null }>(
      `WITH o AS (
         SELECT o.id, COALESCE(io.contact_email, u.email) AS email, COALESCE(io.contact_name, u.name) AS name
           FROM orders.orders o JOIN identity.users u ON u.id = o.user_id
           LEFT JOIN b2b_orders.invoice_orders io ON io.order_id = o.id
          WHERE o.event_id = $1 AND o.status IN ('paid', 'paid_partial') AND u.anonymized_at IS NULL)
       , ins AS (INSERT INTO orders.reschedule_responses (reschedule_id, order_id) SELECT $2, o.id FROM o RETURNING order_id, response_token)
       SELECT ins.response_token AS token, o.email, o.name FROM ins JOIN o ON o.id = ins.order_id`,
      [eventId, rescheduleId],
    )).rows;
    await client.query(`UPDATE catalog.event_reschedules SET recipient_count = $2 WHERE id = $1`, [rescheduleId, recipients.length]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
  const emailed = await mailPostponement(pool, eventId, input.reason, oldDate, deadline, recipients);
  return { rescheduleId, recipients: recipients.length, responseDeadline: deadline, emailed };
}

async function mailPostponement(
  q: Q, eventId: string, reason: string, oldDate: string, deadline: string, recipients: Array<{ token: string; email: string; name: string | null }>,
): Promise<number> {
  const { sendMail } = await import('@/lib/email/mailer');
  const h = await eventHead(q, eventId);
  const appUrl = process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  let sent = 0;
  for (const r of recipients) {
    if (r.email.endsWith('.local')) continue;
    try {
      await sendMail({
        to: r.email,
        subject: `Změna termínu: ${h.title} — nově ${h.date}`,
        html: page(`<p>Dobrý den${r.name ? ` ${escapeHtml(r.name)}` : ''},</p>
          <p>představení <strong>${escapeHtml(h.title)}</strong> se přesouvá z ${escapeHtml(oldDate)} na <strong>${escapeHtml(h.date)}</strong>${h.venue ? ` (${escapeHtml(h.venue)})` : ''}.</p>
          <p>Důvod: ${escapeHtml(reason)}</p><p>Vaše vstupenky <strong>zůstávají platné</strong> pro nový termín — nemusíte nic dělat.</p>
          <p>Pokud vám nový termín nevyhovuje, můžete do <strong>${escapeHtml(fmt(deadline))}</strong> požádat o vrácení vstupného:
          <a href="${appUrl}/cs/reschedule/${r.token}">požádat o vrácení</a></p><p>${escapeHtml(h.promoter)}</p>`),
      });
      sent++;
    } catch (e) { console.error('[postpone-term] mail', r.email, e); }
  }
  return sent;
}
