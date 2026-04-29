/**
 * Formátuje částku z halířů na Kč s českou lokalizací.
 * Ruční implementace kvůli konzistenci v prostředí bez plné i18n podpory.
 */
function formatCzk(amountHalire: number): string {
  const kc = amountHalire / 100;
  // Formátovat ručně: oddělovač tisíců = mezera, desetinná = čárka
  const [intPart, decPart] = kc.toFixed(2).split('.');
  const intFormatted = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0');
  return `${intFormatted},${decPart} Kč`;
}

/**
 * Escapuje HTML speciální znaky pro bezpečné vložení do šablony.
 */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface PayoutApprovedEmailResult {
  subject: string;
  html: string;
}

export interface PayoutPaidEmailResult {
  subject: string;
  html: string;
}

export interface PayoutFailedEmailResult {
  subject: string;
  html: string;
}

export function payoutApprovedEmail(
  promoterName: string,
  amount: number,
  expectedDate: string
): PayoutApprovedEmailResult {
  const formattedAmount = formatCzk(amount);
  const subject = `Výplata ${formattedAmount} byla schválena`;

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
            <td style="background-color:#16a34a;padding:32px 40px;text-align:center;">
              <h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:700;">Tixly</h1>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:40px;">
              <h2 style="margin:0 0 16px 0;color:#111827;font-size:20px;">Výplata schválena ✓</h2>
              <p style="margin:0 0 12px 0;color:#374151;font-size:16px;">
                Dobrý den, <strong>${escapeHtml(promoterName)}</strong>,
              </p>
              <p style="margin:0 0 24px 0;color:#374151;font-size:16px;">
                vaše výplata ve výši <strong style="color:#16a34a;">${escapeHtml(formattedAmount)}</strong> byla schválena a bude zpracována.
              </p>
              <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f0fdf4;border:1px solid #bbf7d0;border-radius:6px;margin-bottom:24px;">
                <tr>
                  <td style="padding:20px;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="color:#374151;font-size:14px;padding:4px 0;">Částka výplaty:</td>
                        <td align="right" style="color:#16a34a;font-size:16px;font-weight:700;padding:4px 0;">${escapeHtml(formattedAmount)}</td>
                      </tr>
                      <tr>
                        <td style="color:#374151;font-size:14px;padding:4px 0;">Očekávané datum připsání:</td>
                        <td align="right" style="color:#111827;font-size:14px;font-weight:600;padding:4px 0;">${escapeHtml(expectedDate)}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 12px 0;color:#6b7280;font-size:14px;">
                Peníze budou odeslány na váš registrovaný bankovní účet. Po připsání platby obdržíte potvrzovací e-mail s referenčním číslem.
              </p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="background-color:#f9fafb;padding:24px 40px;border-top:1px solid #e5e7eb;">
              <p style="margin:0;color:#9ca3af;font-size:12px;text-align:center;">
                © 2026 Tixly s.r.o. | Tento e-mail byl odeslán automaticky, neodpovídejte na něj.<br>
                V případě dotazů nás kontaktujte na <a href="mailto:support@tixly.cz" style="color:#16a34a;">support@tixly.cz</a>
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

export function payoutPaidEmail(
  promoterName: string,
  amount: number,
  bankReference: string,
  paidAt: string
): PayoutPaidEmailResult {
  const formattedAmount = formatCzk(amount);
  const subject = `Výplata ${formattedAmount} odeslána na váš účet`;

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
            <td style="background-color:#2563eb;padding:32px 40px;text-align:center;">
              <h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:700;">Tixly</h1>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:40px;">
              <h2 style="margin:0 0 16px 0;color:#111827;font-size:20px;">Výplata odeslána ✓</h2>
              <p style="margin:0 0 12px 0;color:#374151;font-size:16px;">
                Dobrý den, <strong>${escapeHtml(promoterName)}</strong>,
              </p>
              <p style="margin:0 0 24px 0;color:#374151;font-size:16px;">
                výplata ve výši <strong style="color:#2563eb;">${escapeHtml(formattedAmount)}</strong> byla úspěšně odeslána na váš bankovní účet.
              </p>
              <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#eff6ff;border:1px solid #bfdbfe;border-radius:6px;margin-bottom:24px;">
                <tr>
                  <td style="padding:20px;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="color:#374151;font-size:14px;padding:4px 0;">Odeslaná částka:</td>
                        <td align="right" style="color:#2563eb;font-size:16px;font-weight:700;padding:4px 0;">${escapeHtml(formattedAmount)}</td>
                      </tr>
                      <tr>
                        <td style="color:#374151;font-size:14px;padding:4px 0;">Referenční číslo převodu:</td>
                        <td align="right" style="color:#111827;font-size:14px;font-weight:600;font-family:monospace;padding:4px 0;">${escapeHtml(bankReference)}</td>
                      </tr>
                      <tr>
                        <td style="color:#374151;font-size:14px;padding:4px 0;">Datum odeslání:</td>
                        <td align="right" style="color:#111827;font-size:14px;padding:4px 0;">${escapeHtml(paidAt)}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 12px 0;color:#6b7280;font-size:14px;">
                Peníze by se měly na vašem účtu zobrazit do 1–3 pracovních dnů v závislosti na vaší bance. Referenční číslo použijte při komunikaci s vaší bankou.
              </p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="background-color:#f9fafb;padding:24px 40px;border-top:1px solid #e5e7eb;">
              <p style="margin:0;color:#9ca3af;font-size:12px;text-align:center;">
                © 2026 Tixly s.r.o. | Tento e-mail byl odeslán automaticky, neodpovídejte na něj.<br>
                V případě dotazů nás kontaktujte na <a href="mailto:support@tixly.cz" style="color:#2563eb;">support@tixly.cz</a>
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

export function payoutFailedEmail(
  promoterName: string,
  amount: number,
  reason: string
): PayoutFailedEmailResult {
  const formattedAmount = formatCzk(amount);
  const subject = `Chyba při zpracování výplaty — potřebujeme pomoc`;

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
            <td style="background-color:#dc2626;padding:32px 40px;text-align:center;">
              <h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:700;">Tixly</h1>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:40px;">
              <h2 style="margin:0 0 16px 0;color:#111827;font-size:20px;">Chyba při zpracování výplaty</h2>
              <p style="margin:0 0 12px 0;color:#374151;font-size:16px;">
                Dobrý den, <strong>${escapeHtml(promoterName)}</strong>,
              </p>
              <p style="margin:0 0 24px 0;color:#374151;font-size:16px;">
                při zpracování výplaty ve výši <strong>${escapeHtml(formattedAmount)}</strong> došlo k chybě a peníze nebyly odeslány na váš bankovní účet.
              </p>
              <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#fef2f2;border:1px solid #fecaca;border-radius:6px;margin-bottom:24px;">
                <tr>
                  <td style="padding:20px;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="color:#374151;font-size:14px;padding:4px 0;">Výše výplaty:</td>
                        <td align="right" style="color:#dc2626;font-size:16px;font-weight:700;padding:4px 0;">${escapeHtml(formattedAmount)}</td>
                      </tr>
                      <tr>
                        <td style="color:#374151;font-size:14px;padding:4px 0;vertical-align:top;">Důvod selhání:</td>
                        <td align="right" style="color:#111827;font-size:14px;padding:4px 0;">${escapeHtml(reason)}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 16px 0;color:#374151;font-size:15px;">
                Prosíme o kontaktování naší podpory, abychom mohli situaci co nejdříve vyřešit:
              </p>
              <table cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
                <tr>
                  <td style="background-color:#dc2626;border-radius:6px;padding:12px 24px;">
                    <a href="mailto:support@tixly.cz?subject=Chyba+výplaty+${encodeURIComponent(formattedAmount)}" style="color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;">
                      Kontaktovat podporu
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:0;color:#6b7280;font-size:14px;">
                Nebo nás kontaktujte přímo na <a href="mailto:support@tixly.cz" style="color:#dc2626;">support@tixly.cz</a>. Váš tým Tixly se pokusí výplatu co nejdříve zpracovat znovu.
              </p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="background-color:#f9fafb;padding:24px 40px;border-top:1px solid #e5e7eb;">
              <p style="margin:0;color:#9ca3af;font-size:12px;text-align:center;">
                © 2026 Tixly s.r.o. | Tento e-mail byl odeslán automaticky, neodpovídejte na něj.<br>
                V případě dotazů nás kontaktujte na <a href="mailto:support@tixly.cz" style="color:#dc2626;">support@tixly.cz</a>
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
