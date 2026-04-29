// =============================================================================
// SERVICE: Odesílání potvrzovacího e-mailu s PDF vstupenkami v příloze
// =============================================================================
//
// Wire-up:
//   The order orchestrator (stripe-payments / order-saga) should call
//   sendTicketConfirmationEmail() inside its `order.completed` Kafka consumer,
//   after tickets have been issued. Pattern:
//
//     await sendTicketConfirmationEmail({ orderId, buyerEmail, ... }, deps)
//       .catch(err => console.error('[ticket-email] failed', err));
//
// Fire-and-forget na call-site: tato funkce chyby loguje a nikdy
// nerozbije hlavní order flow (vrací { sent: false } při selhání).
// =============================================================================

import {
  PdfTicketService,
  type PdfTicketDbAdapter,
  type CryptoAdapter,
} from './pdf-ticket.service.js';

// ---------------------------------------------------------------------------
// Typy
// ---------------------------------------------------------------------------

export interface EmailAttachment {
  filename: string;
  content: Buffer;
  contentType: 'application/pdf';
}

export interface TicketEmailAdapter {
  send(input: {
    to: string;
    subject: string;
    html: string;
    attachments: EmailAttachment[];
  }): Promise<void>;
}

export interface TicketConfirmationInput {
  orderId: string;
  buyerEmail: string;
  buyerName: string;
  eventName: string;
  eventDate: string;
  ticketIds: string[];
}

export interface TicketConfirmationResult {
  sent: boolean;
  attachmentCount: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Lowercase, strip diakritiky, non-alphanumeric → "-", trim pomlček.
 * Max délka 40 znaků.
 *
 * "Festival Náměstí Míru" → "festival-namesti-miru"
 */
export function slugify(name: string): string {
  const normalized = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return normalized.slice(0, 40).replace(/-+$/, '');
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildHtml(input: TicketConfirmationInput): string {
  const name = escapeHtml(input.buyerName);
  const ev = escapeHtml(input.eventName);
  const date = escapeHtml(input.eventDate);
  const count = input.ticketIds.length;

  return `<!DOCTYPE html>
<html lang="cs">
  <body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f5f5f5;">
      <tr>
        <td align="center" style="padding:24px;">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff;border-radius:6px;">
            <tr>
              <td style="background:#1a56db;color:#ffffff;padding:20px 24px;font-size:20px;font-weight:bold;">
                TIXLY
              </td>
            </tr>
            <tr>
              <td style="padding:24px;color:#111111;font-size:14px;line-height:1.5;">
                <p style="margin:0 0 12px 0;">Dobrý den ${name},</p>
                <p style="margin:0 0 12px 0;">
                  děkujeme za Vaši objednávku. V příloze najdete
                  <strong>${count}</strong> ${count === 1 ? 'vstupenku' : count < 5 ? 'vstupenky' : 'vstupenek'}
                  na akci <strong>${ev}</strong> (${date}).
                </p>
                <p style="margin:0 0 12px 0;color:#555555;">
                  V příloze najdete PDF vstupenky s QR kódem. QR kód se pravidelně obnovuje —
                  pro skenování na vstupu použijte digitální verzi v appce nebo Wallet.
                </p>
                <p style="margin:16px 0 0 0;color:#888888;font-size:12px;">
                  Číslo objednávky: ${escapeHtml(input.orderId)}
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

// ---------------------------------------------------------------------------
// Hlavní funkce
// ---------------------------------------------------------------------------

/**
 * Vygeneruje PDF pro každou vstupenku v objednávce a odešle jediný
 * potvrzovací e-mail se všemi PDF v příloze.
 *
 * Chyby jsou pouze logovány — funkce nikdy nevyhodí výjimku.
 */
export async function sendTicketConfirmationEmail(
  input: TicketConfirmationInput,
  deps: {
    db: PdfTicketDbAdapter;
    crypto: CryptoAdapter;
    email: TicketEmailAdapter;
  },
): Promise<TicketConfirmationResult> {
  try {
    const service = new PdfTicketService();
    const eventSlug = slugify(input.eventName);

    const attachments: EmailAttachment[] = [];
    for (const ticketId of input.ticketIds) {
      const result = await service.generateForTicket(
        ticketId,
        input.orderId, // MVP: userId není v tomto kontextu relevantní
        'cs',
        deps.db,
        deps.crypto,
      );

      const shortId = ticketId.slice(0, 8);
      attachments.push({
        filename: `vstupenka-${eventSlug}-${shortId}.pdf`,
        content: Buffer.from(result.pdfBytes),
        contentType: 'application/pdf',
      });
    }

    await deps.email.send({
      to: input.buyerEmail,
      subject: `Vaše vstupenky na ${input.eventName}`,
      html: buildHtml(input),
      attachments,
    });

    return { sent: true, attachmentCount: attachments.length };
  } catch (err) {
    console.error('[ticket-email] Odeslání potvrzovacího e-mailu selhalo:', {
      orderId: input.orderId,
      buyerEmail: input.buyerEmail,
      error: err instanceof Error ? err.message : String(err),
    });
    return { sent: false, attachmentCount: 0 };
  }
}
