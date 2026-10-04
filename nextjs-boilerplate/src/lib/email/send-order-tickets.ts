/**
 * Odeslání vstupenek e-mailem — jedna cesta pro všechny případy.
 *
 * Do srpna 2026 uměl vstupenky poslat jediný proces: dokončení zaplacené
 * objednávky. Volné vstupenky, hosté na guestlistu ani objednávky na fakturu
 * e-mail nedostaly vůbec — adresa se jen uložila do databáze a nic se neodeslalo.
 *
 * Tenhle modul to sjednocuje. Použije ho:
 *   • vydání vstupenky na držené místo (umělec, VIP, tisk),
 *   • host z guestlistu,
 *   • znovuodeslání u zaplacené objednávky — včetně těch na fakturu
 *     a bankovní převod, kde e-mail nikdy neodešel.
 *
 * Kterou službou se posílá, řeší `lib/email/mailer` přes proměnné `SMTP_*`.
 * Tenhle modul o poskytovateli neví nic — výměna Resendu za Postmark nebo SES
 * je jen změna nastavení, ne zásah do kódu.
 *
 * PDF s QR kódem: šifrované klíče vstupenek se pro odeslání dešifrují stejně,
 * jako to dělá zobrazení QR kupujícímu. Znovuodeslaná vstupenka je proto plně
 * funkční, ne jen odkaz.
 */

import { decryptSecret } from '@/lib/crypto';
import { db } from '@/lib/db/rls-pool';
import { sendMail } from '@/lib/email/mailer';
import { escapeHtml } from '@/lib/html-escape/escape';
import { orderTicketVatPct } from '@/lib/tax/vat-rates';
import { base32Encode } from '@/lib/tickets/demo-issuer';
import { renderTicketsPdf, type TicketPdfData } from '@/lib/tickets/pdf-renderer';

export interface SendOrderTicketsOptions {
  /** Poslat na jinou adresu, než je na objednávce (host, obdarovaný). */
  toOverride?: string | null;
  /** Věta navíc nad seznamem vstupenek — třeba „Vstupenka pro management kapely". */
  note?: string | null;
  /** Připojit PDF. Vypíná se u akcí, které mají jen rotující QR v mobilu. */
  attachPdf?: boolean;
}

export interface SendOrderTicketsResult {
  sent: boolean;
  to: string | null;
  ticketCount: number;
  pdfAttached: boolean;
  /** Důvod, proč se neodeslalo — pro hlášku v administraci, ne pro logy. */
  reason?: string;
}

interface OrderRow {
  id: string;
  status: string;
  buyer_email: string | null;
  buyer_name: string | null;
  event_title: string;
  event_date_start: string;
  venue_name: string | null;
  promoter_name: string | null;
  brand_color_hex: string | null;
  brand_logo_url: string | null;
  promoter_country: string | null;
  event_vat_category: string | null;
  qr_policy: string | null;
}

interface TicketRow {
  ticket_id: string;
  ticket_type_name: string;
  totp_secret_encrypted: Buffer | null;
  unit_price: number | null;
  sector: string | null;
  row: string | null;
  seat_number: string | null;
}

function seatLabel(t: TicketRow): string | null {
  if (!t.sector) return null;
  return `${t.sector} · řada ${t.row ?? '?'} · sedadlo ${t.seat_number ?? '?'}`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('cs-CZ', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Pošle vstupenky k objednávce. Nevyhazuje výjimku — vrací důvod, proč
 * se neodeslalo, aby to administrace mohla ukázat člověku.
 */
export async function sendOrderTickets(
  orderId: string,
  opts: SendOrderTicketsOptions = {},
): Promise<SendOrderTicketsResult> {
  const orderRes = await db().query<OrderRow>(
    `SELECT o.id, o.status, u.email AS buyer_email, u.name AS buyer_name,
            e.title AS event_title, e.date_start::text AS event_date_start,
            e.qr_policy, e.vat_category AS event_vat_category,
            v.name AS venue_name,
            p.name AS promoter_name, p.country AS promoter_country,
            p.brand_color_hex, p.brand_logo_url
     FROM orders.orders o
     LEFT JOIN identity.users u ON u.id = o.user_id
     JOIN catalog.events e ON e.id = o.event_id
     LEFT JOIN catalog.venues v ON v.id = e.venue_id
     LEFT JOIN platform.promoters p ON p.id = e.promoter_id
     WHERE o.id = $1`,
    [orderId],
  );
  const order = orderRes.rows[0];
  if (!order) {
    return { sent: false, to: null, ticketCount: 0, pdfAttached: false, reason: 'Objednávka nenalezena.' };
  }

  const to = opts.toOverride?.trim() || order.buyer_email;
  if (!to) {
    return {
      sent: false,
      to: null,
      ticketCount: 0,
      pdfAttached: false,
      reason: 'Objednávka nemá e-mailovou adresu, kam poslat.',
    };
  }

  const ticketsRes = await db().query<TicketRow>(
    `SELECT t.id AS ticket_id, tt.name AS ticket_type_name,
            t.totp_secret_encrypted, oi.unit_price,
            es.sector, es.row, es.seat_number
     FROM tickets.tickets t
     JOIN catalog.ticket_types tt ON tt.id = t.ticket_type_id
     LEFT JOIN orders.order_items oi
       ON oi.order_id = t.order_id AND oi.ticket_type_id = t.ticket_type_id
     LEFT JOIN catalog.event_seats es ON es.id = t.event_seat_id
     WHERE t.order_id = $1 AND t.revoked_at IS NULL
     ORDER BY es.sector, es.row, es.seat_number, t.id`,
    [orderId],
  );
  const tickets = ticketsRes.rows;
  if (tickets.length === 0) {
    return {
      sent: false,
      to,
      ticketCount: 0,
      pdfAttached: false,
      reason: 'K objednávce nejsou vydané žádné platné vstupenky.',
    };
  }

  // PDF s QR. Akce s rotujícím QR ho záměrně nedostávají — kód platí půl minuty
  // a vytištěný by byl k ničemu.
  const wantPdf = opts.attachPdf !== false && order.qr_policy !== 'rotating_only';
  let pdfAttachment: { filename: string; content: Buffer; contentType: string } | null = null;

  if (wantPdf) {
    const pdfTickets: TicketPdfData[] = [];
    for (const t of tickets) {
      if (!t.totp_secret_encrypted) continue;
      try {
        const secretB64 = decryptSecret(t.totp_secret_encrypted.toString('base64'));
        pdfTickets.push({
          ticketId: t.ticket_id,
          ticketTypeName: t.ticket_type_name,
          totpSecretBase32: base32Encode(Buffer.from(secretB64, 'base64')),
          holderLabel: to,
          issuer: order.event_title,
          unitPriceHalire: t.unit_price ?? 0,
          seatLabel: seatLabel(t),
        });
      } catch (err) {
        // Nedešifrovatelný klíč znamená, že se změnil šifrovací klíč prostředí.
        // Vstupenku pošleme bez PDF, ale mlčky ji nezahodíme.
        console.error('[send-order-tickets] nelze dešifrovat klíč vstupenky', t.ticket_id, err);
      }
    }

    if (pdfTickets.length > 0) {
      try {
        const buf = await renderTicketsPdf(
          {
            eventTitle: order.event_title,
            eventDateStart: order.event_date_start,
            venueName: order.venue_name,
            buyerName: order.buyer_name ?? '',
            buyerEmail: to,
            orderId: order.id,
            promoterName: order.promoter_name,
            brandColorHex: order.brand_color_hex,
            brandLogoUrl: order.brand_logo_url,
            vatRatePct: await orderTicketVatPct(db(), order.id),
          },
          pdfTickets,
        );
        pdfAttachment = {
          filename: `vstupenky-${order.id.slice(0, 8)}.pdf`,
          content: buf,
          contentType: 'application/pdf',
        };
      } catch (err) {
        console.error('[send-order-tickets] PDF se nepodařilo vytvořit', err);
      }
    }
  }

  const rows = tickets
    .map((t) => {
      const seat = seatLabel(t);
      return `<tr>
        <td style="padding:6px 10px;border-bottom:1px solid #eee">${escapeHtml(t.ticket_type_name)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee">${seat ? escapeHtml(seat) : '—'}</td>
      </tr>`;
    })
    .join('');

  const senderName = order.promoter_name ?? 'Tixly';
  const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:600px">
    <h2 style="margin:0 0 4px">${escapeHtml(order.event_title)}</h2>
    <p style="margin:0 0 16px;color:#555">
      ${escapeHtml(formatDate(order.event_date_start))}${order.venue_name ? ` · ${escapeHtml(order.venue_name)}` : ''}
    </p>
    ${opts.note ? `<p style="margin:0 0 16px;padding:10px;background:#f6f6f4;border-radius:4px">${escapeHtml(opts.note)}</p>` : ''}
    <table style="border-collapse:collapse;width:100%;font-size:14px">
      <thead>
        <tr>
          <th style="text-align:left;padding:6px 10px;border-bottom:2px solid #ddd">Vstupenka</th>
          <th style="text-align:left;padding:6px 10px;border-bottom:2px solid #ddd">Místo</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <p style="margin:16px 0 0;font-size:14px;color:#555">
      ${
        pdfAttachment
          ? 'Vstupenky s QR kódem najdete v příloze. Stačí je ukázat na displeji telefonu nebo vytištěné.'
          : 'QR kód se zobrazí ve vaší vstupence před začátkem akce.'
      }
    </p>
    <p style="margin:16px 0 0;font-size:12px;color:#888">${escapeHtml(senderName)}</p>
  </div>`;

  try {
    await sendMail({
      from: `"${senderName}" <${process.env.EMAIL_FROM ?? 'vstupenky@tixly.local'}>`,
      to,
      subject: `${senderName} — vstupenky na ${order.event_title}`,
      html,
      attachments: pdfAttachment ? [pdfAttachment] : undefined,
    });
  } catch (err) {
    console.error('[send-order-tickets] odeslání selhalo', err);
    return {
      sent: false,
      to,
      ticketCount: tickets.length,
      pdfAttached: false,
      reason: 'E-mail se nepodařilo odeslat. Zkontroluj nastavení SMTP.',
    };
  }

  return {
    sent: true,
    to,
    ticketCount: tickets.length,
    pdfAttached: pdfAttachment !== null,
  };
}
