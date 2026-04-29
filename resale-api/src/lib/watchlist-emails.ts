/**
 * Watchlist match email template (Feature #48).
 *
 * Used by the notification consumer subscribed to the `watchlist.match`
 * event emitted by `WatchlistService.notifyMatchingWatchers`.
 */

/**
 * Formátuje částku z halířů na Kč s českou lokalizací
 * (oddělovač tisíců = nedělitelná mezera, desetinná = čárka).
 */
function formatCzk(amountHalire: number): string {
  const kc = amountHalire / 100;
  const [intPart, decPart] = kc.toFixed(2).split('.');
  const intFormatted = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0');
  return `${intFormatted},${decPart} Kč`;
}

/** Escapuje HTML speciální znaky pro bezpečné vložení do šablony. */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface WatchlistMatchEmailResult {
  subject: string;
  html: string;
}

export function watchlistMatchEmail(input: {
  recipientName: string;
  eventName: string;
  eventDate: string;
  askPriceHalire: number;
  zone: string | null;
  listingUrl: string;
}): WatchlistMatchEmailResult {
  const { recipientName, eventName, eventDate, askPriceHalire, zone, listingUrl } = input;
  const formattedAmount = formatCzk(askPriceHalire);
  const subject = `Vstupenka na ${eventName} je k dispozici v resale`;

  const zoneRow = zone
    ? `<tr>
                        <td style="color:#374151;font-size:14px;padding:4px 0;">Sektor:</td>
                        <td align="right" style="color:#111827;font-size:14px;font-weight:600;padding:4px 0;">${escapeHtml(zone)}</td>
                      </tr>`
    : '';

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
            <td style="background-color:#6C47FF;padding:32px 40px;text-align:center;">
              <h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:700;">Tixly</h1>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:40px;">
              <h2 style="margin:0 0 16px 0;color:#111827;font-size:20px;">Vstupenka je k dispozici!</h2>
              <p style="margin:0 0 12px 0;color:#374151;font-size:16px;">
                Dobrý den, <strong>${escapeHtml(recipientName)}</strong>,
              </p>
              <p style="margin:0 0 24px 0;color:#374151;font-size:16px;">
                na akci <strong>${escapeHtml(eventName)}</strong>, kterou sledujete, se právě objevila nová nabídka v resale.
              </p>
              <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f5f3ff;border:1px solid #ddd6fe;border-radius:6px;margin-bottom:24px;">
                <tr>
                  <td style="padding:20px;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="color:#374151;font-size:14px;padding:4px 0;">Akce:</td>
                        <td align="right" style="color:#111827;font-size:14px;font-weight:600;padding:4px 0;">${escapeHtml(eventName)}</td>
                      </tr>
                      <tr>
                        <td style="color:#374151;font-size:14px;padding:4px 0;">Datum:</td>
                        <td align="right" style="color:#111827;font-size:14px;font-weight:600;padding:4px 0;">${escapeHtml(eventDate)}</td>
                      </tr>
                      ${zoneRow}
                      <tr>
                        <td style="color:#374151;font-size:14px;padding:4px 0;">Cena:</td>
                        <td align="right" style="color:#6C47FF;font-size:16px;font-weight:700;padding:4px 0;">${escapeHtml(formattedAmount)}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
              <table cellpadding="0" cellspacing="0" style="margin:0 auto 24px auto;">
                <tr>
                  <td style="background-color:#6C47FF;border-radius:6px;padding:14px 32px;">
                    <a href="${escapeHtml(listingUrl)}" style="color:#ffffff;text-decoration:none;font-size:16px;font-weight:600;">
                      Zobrazit nabídku
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:0;color:#6b7280;font-size:13px;text-align:center;">
                Pospěšte si — nabídky v resale jsou často rychle vyprodané.
              </p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="background-color:#f9fafb;padding:24px 40px;border-top:1px solid #e5e7eb;">
              <p style="margin:0;color:#9ca3af;font-size:12px;text-align:center;">
                Toto je upozornění z vašeho watchlistu. Pokud již nemáte zájem, můžete jej deaktivovat v sekci Moje watchlists.<br><br>
                © 2026 Tixly s.r.o. | Tento e-mail byl odeslán automaticky, neodpovídejte na něj.
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
