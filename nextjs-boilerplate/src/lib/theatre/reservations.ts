/**
 * Rezervace s platbou na pokladně (kolo 8 / krok 5).
 *
 * Rezervace = objednávka orders.orders 'pending' (místa sold + order_id, jako u online nákupu) s expires_at = lhůta
 * vyzvednutí, plus řádek orders.seat_reservations (kód, kontakt, stav, připomínka, storno token).
 *   - lhůta: N dní od vytvoření (events.reservation_days, výchozí 5), nejpozději M hodin před začátkem
 *     (events.reservation_cutoff_hours, výchozí 2) — počítá a vynucuje server (vytvoření i platba na pokladně);
 *   - limity: max 2 aktivní rezervace a max 10 míst na e-mail a termín (pod advisory lockem e-mail × termín);
 *   - pokladna: platba hotově / kartou → objednávka paid, vstupenky (demo-issuer), doklad (issueOrderDocument),
 *     zápis do směny pokladny (box-office.ts);
 *   - cron: připomínka 24 h před koncem lhůty, propadlé rezervace uvolní místa (release-capacity) + e-mail;
 *   - kupec ruší odkazem z e-mailu (kód + token; v DB jen hash tokenu).
 */
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'crypto';
import { escapeHtml } from '@/lib/html-escape/escape';
import { releaseOrderCapacity } from '@/lib/orders/release-capacity';

interface Q { query<R extends Record<string, unknown> = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: R[]; rowCount: number | null }> }

export const MAX_ACTIVE_RESERVATIONS = 2;
export const MAX_RESERVED_SEATS = 10;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export class ReservationError extends Error {
  constructor(
    public code: 'RESERVATIONS_DISABLED' | 'RESERVATION_CLOSED' | 'RESERVATION_LIMIT' | 'RESERVATION_SEAT_LIMIT'
      | 'NOT_FOUND' | 'NOT_ACTIVE' | 'RESERVATION_EXPIRED' | 'BAD_TOKEN',
    message: string,
    public status = 422,
  ) {
    super(message);
  }
}

/** Lhůta vyzvednutí: min(vytvoření + N dní, začátek − M hodin); null = už se rezervovat nedá. */
export function reservationDeadline(now: Date, startsAt: Date, days: number, cutoffHours: number): Date | null {
  const byDays = now.getTime() + days * 86_400_000;
  const byStart = startsAt.getTime() - cutoffHours * 3_600_000;
  const t = Math.min(byDays, byStart);
  return t > now.getTime() ? new Date(t) : null;
}

export function generateReservationCode(): string {
  let s = '';
  for (let i = 0; i < 8; i++) s += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return s;
}

const hashToken = (t: string): string => createHash('sha256').update(t).digest('hex');

export interface ReservationSettings { reservations_enabled: boolean; reservation_days: number; reservation_cutoff_hours: number; date_start: string | Date }

/** Ověří, že termín rezervace přijímá, a vrátí lhůtu. */
export function assertReservable(ev: ReservationSettings, now = new Date()): Date {
  if (!ev.reservations_enabled) throw new ReservationError('RESERVATIONS_DISABLED', 'Na tento termín nelze rezervovat — kupte prosím vstupenky online.');
  const d = reservationDeadline(now, new Date(ev.date_start), ev.reservation_days, ev.reservation_cutoff_hours);
  if (!d) throw new ReservationError('RESERVATION_CLOSED', 'Rezervace na tento termín už skončily — kupte prosím vstupenky online.');
  return d;
}

/**
 * Založí řádek rezervace k právě vytvořené pending objednávce (v transakci checkoutu, PŘED vložením objednávky
 * je třeba zavolat checkReservationLimits). Vrací kód a jednorázový storno token (do e-mailu).
 */
export async function checkReservationLimits(q: Q, eventId: string, email: string, seatCount: number): Promise<void> {
  await q.query(`SELECT pg_advisory_xact_lock(hashtext('seat-reservation:' || $1 || ':' || lower($2)))`, [eventId, email]);
  const r = (await q.query<{ n: number; seats: number }>(
    `SELECT COUNT(*)::int AS n, COALESCE(SUM(seat_count), 0)::int AS seats FROM orders.seat_reservations
      WHERE event_id = $1 AND lower(buyer_email) = lower($2) AND status = 'active' AND expires_at > now()`,
    [eventId, email],
  )).rows[0];
  if (r.n >= MAX_ACTIVE_RESERVATIONS) {
    throw new ReservationError('RESERVATION_LIMIT', `Na jeden e-mail lze mít na termín nejvýš ${MAX_ACTIVE_RESERVATIONS} aktivní rezervace.`);
  }
  if (r.seats + seatCount > MAX_RESERVED_SEATS) {
    throw new ReservationError('RESERVATION_SEAT_LIMIT', `Na jeden e-mail lze na termín rezervovat nejvýš ${MAX_RESERVED_SEATS} míst.`);
  }
}

export async function insertReservation(q: Q, input: {
  orderId: string; eventId: string; promoterId: string; email: string; name: string; phone: string | null; seatCount: number; expiresAt: Date;
}): Promise<{ id: string; code: string; cancelToken: string }> {
  const cancelToken = randomBytes(24).toString('base64url');
  // kód je unikátní; při (vzácné) kolizi zkusíme jiný
  for (let attempt = 0; attempt < 6; attempt++) {
    const code = generateReservationCode();
    const id = (await q.query<{ id: string }>(
      `INSERT INTO orders.seat_reservations (order_id, event_id, promoter_id, code, buyer_email, buyer_name, buyer_phone, seat_count, expires_at, cancel_token_hash)
       VALUES ($1, $2, $3, $4, lower($5), $6, $7, $8, $9, $10)
       ON CONFLICT (code) DO NOTHING RETURNING id`,
      [input.orderId, input.eventId, input.promoterId, code, input.email, input.name, input.phone, input.seatCount, input.expiresAt, hashToken(cancelToken)],
    )).rows[0]?.id;
    if (id) return { id, code, cancelToken };
  }
  throw new Error('reservation code collision');
}

type ReservationRow = {
  id: string; order_id: string; event_id: string; promoter_id: string; code: string; status: string;
  expires_at: Date; buyer_email: string; buyer_name: string; buyer_phone: string | null; seat_count: number;
};

/** Platba rezervace na pokladně (transakce volajícího v kontextu pořadatele). */
export async function payReservation(q: Q, input: {
  reservationId: string; promoterId: string; cashierUserId: string; paymentType: 'cash' | 'card'; cashTenderedMinor?: number | null;
}): Promise<{ orderId: string; eventId: string; invoiceId: string | null; receiptNumber: string; changeMinor: number; tickets: Array<{ ticketId: string }>; totalMinor: number }> {
  const r = (await q.query<ReservationRow>(
    `SELECT * FROM orders.seat_reservations WHERE id = $1 AND promoter_id = $2 FOR UPDATE`, [input.reservationId, input.promoterId],
  )).rows[0];
  if (!r) throw new ReservationError('NOT_FOUND', 'Rezervace nenalezena.', 404);
  if (r.status !== 'active') throw new ReservationError('NOT_ACTIVE', `Rezervace není aktivní (stav: ${r.status}).`, 409);
  if (new Date(r.expires_at).getTime() <= Date.now()) throw new ReservationError('RESERVATION_EXPIRED', 'Lhůta rezervace vypršela — místa se uvolňují.', 409);

  const ord = (await q.query<{ status: string; total_amount: number }>(
    `SELECT status, total_amount FROM orders.orders WHERE id = $1 FOR UPDATE`, [r.order_id],
  )).rows[0];
  if (!ord || ord.status !== 'pending') throw new ReservationError('NOT_ACTIVE', 'Objednávka rezervace už není otevřená.', 409);

  await q.query(
    `UPDATE orders.orders SET status = 'paid', paid_at = now(), payment_provider = 'box_office', updated_at = now() WHERE id = $1`,
    [r.order_id],
  );
  const { issueTicketsForOrder } = await import('@/lib/tickets/demo-issuer');
  const issued = await issueTicketsForOrder(r.order_id, q as never);
  const { issueOrderDocument } = await import('@/lib/accounting/documents');
  // číselná řada dokladů zapisuje jen systém — stejný vzor jako /api/admin/invoices (asSystemInTx)
  const { asSystemInTx } = await import('@/lib/db/rls-pool');
  const doc = await asSystemInTx(q as never, () => issueOrderDocument(q as never, r.order_id, { name: r.buyer_name, email: r.buyer_email }));
  const num = (await q.query<{ invoice_number: string }>(`SELECT invoice_number FROM orders.invoices WHERE id = $1`, [doc.invoiceId])).rows[0]?.invoice_number ?? r.code;
  const { orderLines, recordBoxOfficePayment } = await import('@/lib/theatre/box-office');
  const rec = await recordBoxOfficePayment(q, {
    eventId: r.event_id, cashierUserId: input.cashierUserId, orderId: r.order_id, paymentType: input.paymentType,
    lines: await orderLines(q, r.order_id), receiptNumber: `REZ-${r.code}`, cashTenderedMinor: input.cashTenderedMinor,
  });
  await q.query(
    `UPDATE orders.seat_reservations SET status = 'paid', paid_at = now(), payment_type = $2, paid_by_user_id = $3, closed_at = now(), updated_at = now() WHERE id = $1`,
    [r.id, input.paymentType, input.cashierUserId],
  );
  return {
    orderId: r.order_id, eventId: r.event_id, invoiceId: doc.invoiceId, receiptNumber: num, changeMinor: rec.changeMinor,
    tickets: issued.map((t) => ({ ticketId: t.ticketId })), totalMinor: ord.total_amount,
  };
}

/** Uzavře rezervaci bez platby (storno kupcem / propadnutí): objednávka → cancelled/expired, místa a kapacita zpět. */
async function closeUnpaid(q: Q, r: ReservationRow, status: 'cancelled' | 'expired'): Promise<void> {
  const upd = await q.query(
    `UPDATE orders.orders SET status = $2, updated_at = now(), cancelled_by_buyer_at = CASE WHEN $2 = 'cancelled' THEN now() ELSE cancelled_by_buyer_at END
      WHERE id = $1 AND status = 'pending'`,
    [r.order_id, status],
  );
  if ((upd.rowCount ?? 0) > 0) await releaseOrderCapacity(q as never, [r.order_id]);
  await q.query(`UPDATE orders.seat_reservations SET status = $2, closed_at = now(), updated_at = now() WHERE id = $1`, [r.id, status]);
}

/** Storno odkazem z e-mailu (servisní kontext; ověřuje kód + token). */
export async function cancelReservationByToken(q: Q, code: string, token: string): Promise<ReservationRow> {
  const r = (await q.query<ReservationRow & { cancel_token_hash: string }>(
    `SELECT * FROM orders.seat_reservations WHERE code = $1 FOR UPDATE`, [code.toUpperCase()],
  )).rows[0];
  const a = Buffer.from(r?.cancel_token_hash ?? '0'.repeat(64), 'hex');
  const b = Buffer.from(hashToken(token), 'hex');
  if (!r || a.length !== b.length || !timingSafeEqual(a, b)) throw new ReservationError('BAD_TOKEN', 'Odkaz pro zrušení rezervace není platný.', 404);
  if (r.status !== 'active') throw new ReservationError('NOT_ACTIVE', `Rezervace už není aktivní (stav: ${r.status}).`, 409);
  await closeUnpaid(q, r, 'cancelled');
  return r;
}

/** Cron: propadlé aktivní rezervace → expired + uvolnění míst. Vrací uzavřené (pro e-maily po commitu). */
export async function expireDueReservations(q: Q, limit = 200): Promise<ReservationRow[]> {
  const due = (await q.query<ReservationRow>(
    `SELECT * FROM orders.seat_reservations WHERE status = 'active' AND expires_at <= now()
      ORDER BY expires_at LIMIT $1 FOR UPDATE SKIP LOCKED`,
    [limit],
  )).rows;
  for (const r of due) await closeUnpaid(q, r, 'expired');
  return due;
}

/** Cron: aktivní rezervace končící do 24 h (a založené dřív než 24 h před koncem) bez připomínky. */
export async function claimDueReminders(q: Q, limit = 200): Promise<ReservationRow[]> {
  return (await q.query<ReservationRow>(
    `UPDATE orders.seat_reservations SET reminded_at = now(), updated_at = now()
      WHERE id IN (
        SELECT id FROM orders.seat_reservations
         WHERE status = 'active' AND reminded_at IS NULL AND expires_at > now()
           AND expires_at <= now() + interval '24 hours' AND created_at <= expires_at - interval '24 hours'
         ORDER BY expires_at LIMIT $1 FOR UPDATE SKIP LOCKED)
      RETURNING *`,
    [limit],
  )).rows;
}

// ── e-maily ────────────────────────────────────────────────────────────────

interface MailData { title: string; dateStart: string; venue: string | null; seats: string[]; totalMinor: number; currency: string }

async function mailData(q: Q, orderId: string): Promise<MailData> {
  const o = (await q.query<{ title: string; date_start: Date; venue: string | null; total_amount: number; currency: string }>(
    `SELECT e.title, e.date_start, v.name AS venue, o.total_amount, o.currency
       FROM orders.orders o JOIN catalog.events e ON e.id = o.event_id LEFT JOIN catalog.venues v ON v.id = e.venue_id
      WHERE o.id = $1`,
    [orderId],
  )).rows[0];
  const money = (m: number): string => `${(m / 100).toLocaleString('cs-CZ')} ${o.currency}`;
  const seats = (await q.query<{ sector: string | null; row: string | null; seat_number: string | null; category: string | null; unit_price: number }>(
    `SELECT es.sector, es.row, es.seat_number, oi.price_category_name AS category, oi.unit_price
       FROM orders.order_items oi JOIN catalog.event_seats es ON es.id = oi.seat_id
      WHERE oi.order_id = $1 ORDER BY es.sector, es.row, es.seat_number`,
    [orderId],
  )).rows.map((x) => `${[x.sector, x.row && `řada ${x.row}`, x.seat_number && `místo ${x.seat_number}`].filter(Boolean).join(', ')}${x.category ? ` — ${x.category}` : ''} — ${money(x.unit_price)}`);
  return { title: o.title, dateStart: new Date(o.date_start).toLocaleString('cs-CZ', { timeZone: 'Europe/Prague' }), venue: o.venue, seats, totalMinor: o.total_amount, currency: o.currency };
}

const fmtDeadline = (d: Date): string => new Date(d).toLocaleString('cs-CZ', { timeZone: 'Europe/Prague', dateStyle: 'long', timeStyle: 'short' });

export async function sendReservationMail(
  q: Q,
  kind: 'created' | 'reminder' | 'expired' | 'cancelled',
  r: { order_id: string; code: string; buyer_email: string; buyer_name: string; expires_at: Date },
  cancelToken?: string,
): Promise<void> {
  const { sendMail } = await import('@/lib/email/mailer');
  const d = await mailData(q, r.order_id);
  const appUrl = process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  const total = `${(d.totalMinor / 100).toLocaleString('cs-CZ')} ${d.currency}`;
  const seatsHtml = `<ul>${d.seats.map((s) => `<li>${escapeHtml(s)}</li>`).join('')}</ul>`;
  const head = `<p><strong>${escapeHtml(d.title)}</strong><br>${escapeHtml(d.dateStart)}${d.venue ? `, ${escapeHtml(d.venue)}` : ''}</p>`;
  const cancelLink = cancelToken
    ? `<p>Rezervaci můžete zrušit zde: <a href="${appUrl}/cs/rezervace/zrusit?code=${r.code}&token=${encodeURIComponent(cancelToken)}">zrušit rezervaci</a></p>`
    : '';
  const subjects = {
    created: `Rezervace ${r.code} — vyzvedněte a zaplaťte do ${fmtDeadline(r.expires_at)}`,
    reminder: `Připomínka: rezervace ${r.code} vyprší ${fmtDeadline(r.expires_at)}`,
    expired: `Rezervace ${r.code} vypršela`,
    cancelled: `Rezervace ${r.code} je zrušená`,
  } as const;
  const bodies = {
    created: `<p>Dobrý den ${escapeHtml(r.buyer_name)},</p><p>rezervovali jsme pro vás tato místa:</p>${head}${seatsHtml}
      <p>Kód rezervace: <strong style="font-size:20px;letter-spacing:2px">${r.code}</strong><br>Cena celkem: <strong>${total}</strong><br>
      Vyzvedněte a zaplaťte na pokladně (hotově nebo kartou) nejpozději <strong>${fmtDeadline(r.expires_at)}</strong>. Potom se místa automaticky uvolní.</p>${cancelLink}`,
    reminder: `<p>Dobrý den ${escapeHtml(r.buyer_name)},</p><p>vaše rezervace <strong>${r.code}</strong> vyprší <strong>${fmtDeadline(r.expires_at)}</strong>. Vyzvedněte ji prosím na pokladně.</p>${head}${seatsHtml}<p>Cena celkem: ${total}</p>`,
    expired: `<p>Dobrý den ${escapeHtml(r.buyer_name)},</p><p>rezervace <strong>${r.code}</strong> nebyla vyzvednuta do ${fmtDeadline(r.expires_at)} a místa jsme uvolnili do prodeje.</p>${head}${seatsHtml}`,
    cancelled: `<p>Dobrý den ${escapeHtml(r.buyer_name)},</p><p>rezervaci <strong>${r.code}</strong> jsme zrušili a místa uvolnili.</p>${head}${seatsHtml}`,
  } as const;
  await sendMail({
    to: r.buyer_email,
    subject: subjects[kind],
    html: `<!DOCTYPE html><html><body style="font-family:system-ui;max-width:600px;padding:24px">${bodies[kind]}</body></html>`,
  });
}
