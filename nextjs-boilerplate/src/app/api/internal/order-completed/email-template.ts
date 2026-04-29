/**
 * Czech HTML email template for order confirmation with ticket PDF attachments.
 * Table-based layout for maximum email client compatibility.
 * Brand color: #6C47FF
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatCzk(amountHalire: number): string {
  const kc = amountHalire / 100;
  const [intPart, decPart] = kc.toFixed(2).split('.');
  const intFormatted = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0');
  return `${intFormatted},${decPart}\u00a0Kč`;
}

function ticketNoun(count: number): string {
  if (count === 1) return 'vstupenku';
  if (count >= 2 && count <= 4) return 'vstupenky';
  return 'vstupenek';
}

// ---------------------------------------------------------------------------
// Template
// ---------------------------------------------------------------------------

export interface OrderConfirmationEmailInput {
  buyerName: string;
  eventName: string;
  eventDate: string;
  venueName: string;
  ticketCount: number;
  totalHalire: number;
  orderNumber: string;
  myTicketsUrl: string;
}

export interface OrderConfirmationEmailResult {
  subject: string;
  html: string;
}

export function orderConfirmationEmail(
  input: OrderConfirmationEmailInput,
): OrderConfirmationEmailResult {
  const name = escapeHtml(input.buyerName);
  const event = escapeHtml(input.eventName);
  const date = escapeHtml(input.eventDate);
  const venue = escapeHtml(input.venueName);
  const order = escapeHtml(input.orderNumber);
  const count = input.ticketCount;
  const total = formatCzk(input.totalHalire);
  const ctaUrl = escapeHtml(input.myTicketsUrl);

  const subject = `Vaše vstupenky na ${input.eventName}`;

  const html = `<!DOCTYPE html>
<html lang="cs">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f4f5;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f5;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
          <!-- Header -->
          <tr>
            <td style="background-color:#6C47FF;padding:24px 32px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="color:#ffffff;font-size:22px;font-weight:bold;letter-spacing:1px;">
                    TIXLY
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:32px;">
              <p style="margin:0 0 16px 0;font-size:16px;color:#111111;">
                Dobr\u00fd den, ${name},
              </p>
              <p style="margin:0 0 20px 0;font-size:15px;color:#333333;line-height:1.6;">
                va\u0161e objedn\u00e1vka <strong>#${order}</strong> byla \u00fasp\u011b\u0161n\u011b zaplacena.
              </p>

              <!-- Event info box -->
              <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f8f7ff;border-radius:6px;border:1px solid #e8e4ff;margin:0 0 24px 0;">
                <tr>
                  <td style="padding:20px 24px;">
                    <p style="margin:0 0 8px 0;font-size:17px;font-weight:bold;color:#6C47FF;">
                      ${event}
                    </p>
                    <p style="margin:0 0 4px 0;font-size:14px;color:#555555;">
                      ${date}
                    </p>
                    <p style="margin:0;font-size:14px;color:#555555;">
                      ${venue}
                    </p>
                  </td>
                </tr>
              </table>

              <!-- Ticket count + total -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px 0;">
                <tr>
                  <td style="font-size:14px;color:#333333;padding:4px 0;">
                    Po\u010det vstupenek: <strong>${count} ${ticketNoun(count)}</strong>
                  </td>
                </tr>
                <tr>
                  <td style="font-size:14px;color:#333333;padding:4px 0;">
                    Celkov\u00e1 cena: <strong>${total}</strong>
                  </td>
                </tr>
              </table>

              <!-- PDF note -->
              <p style="margin:0 0 12px 0;font-size:14px;color:#555555;line-height:1.5;">
                V p\u0159\u00edloze najdete PDF vstupenky s QR k\u00f3dem.
              </p>
              <p style="margin:0 0 24px 0;font-size:13px;color:#888888;line-height:1.5;">
                QR k\u00f3d se pravideln\u011b obnovuje \u2014 pro skenov\u00e1n\u00ed na vstupu doporu\u010dujeme digit\u00e1ln\u00ed verzi.
              </p>

              <!-- CTA button -->
              <table cellpadding="0" cellspacing="0" style="margin:0 0 24px 0;">
                <tr>
                  <td style="background-color:#6C47FF;border-radius:6px;">
                    <a href="${ctaUrl}"
                       style="display:inline-block;padding:14px 32px;color:#ffffff;font-size:15px;font-weight:bold;text-decoration:none;">
                      Zobrazit moje vstupenky
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:20px 32px;background-color:#fafafa;border-top:1px solid #eeeeee;">
              <p style="margin:0 0 4px 0;font-size:12px;color:#999999;">
                Tixly s.r.o.
              </p>
              <p style="margin:0;font-size:12px;color:#999999;">
                Podpora: <a href="mailto:podpora@tixly.cz" style="color:#6C47FF;">podpora@tixly.cz</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return { subject, html };
}
