/**
 * Escapes HTML special characters to prevent XSS in email templates.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

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
 * Wraps content in a base HTML email layout.
 */
function baseLayout(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="cs">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f4f5;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f5;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
          <tr>
            <td style="background-color:#1a1a2e;padding:24px 40px;">
              <h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:700;letter-spacing:-0.5px;">Tixly</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:40px;">
              ${body}
            </td>
          </tr>
          <tr>
            <td style="background-color:#f4f4f5;padding:24px 40px;text-align:center;">
              <p style="margin:0;color:#6b7280;font-size:12px;">
                &copy; 2026 Tixly. Všechna práva vyhrazena.
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

/**
 * Template 1: Email verification
 * Subject: "Tixly — potvrďte svůj e-mail"
 */
export function verificationEmail(email: string, verificationUrl: string): { subject: string; html: string } {
  const subject = 'Tixly — potvrďte svůj e-mail';
  const body = `
    <h2 style="margin:0 0 16px;color:#1a1a2e;font-size:22px;">Ověřte svůj email</h2>
    <p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:1.6;">
      Dobrý den,
    </p>
    <p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:1.6;">
      pro dokončení registrace na platformě Tixly je potřeba ověřit váš e-mail <strong>${escapeHtml(email)}</strong>.
    </p>
    <p style="margin:0 0 32px;color:#374151;font-size:15px;line-height:1.6;">
      Klikněte na tlačítko níže a ověřte svůj účet. Odkaz je platný <strong>24 hodin</strong>.
    </p>
    <table cellpadding="0" cellspacing="0" style="margin:0 0 32px;">
      <tr>
        <td style="background-color:#4f46e5;border-radius:6px;">
          <a href="${escapeHtml(verificationUrl)}" style="display:inline-block;padding:14px 28px;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;">
            Ověřit email
          </a>
        </td>
      </tr>
    </table>
    <p style="margin:0 0 8px;color:#6b7280;font-size:13px;line-height:1.5;">
      Pokud tlačítko nefunguje, zkopírujte a vložte tento odkaz do prohlížeče:
    </p>
    <p style="margin:0 0 16px;word-break:break-all;">
      <a href="${escapeHtml(verificationUrl)}" style="color:#4f46e5;font-size:13px;">${escapeHtml(verificationUrl)}</a>
    </p>
    <p style="margin:0;color:#6b7280;font-size:13px;line-height:1.5;">
      Pokud jste si účet nevytvářeli, tento e-mail ignorujte.
    </p>`;
  return { subject, html: baseLayout(subject, body) };
}

/**
 * Template 2: Welcome email after email verification
 * Subject: "Vítejte na Ticketariu — vytvořte svůj profil"
 */
export function welcomeEmail(promoterName: string): { subject: string; html: string } {
  const subject = 'Vítejte na Ticketariu — vytvořte svůj profil';
  const body = `
    <h2 style="margin:0 0 16px;color:#1a1a2e;font-size:22px;">Vítejte na Ticketariu! 👋</h2>
    <p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:1.6;">
      Dobrý den, <strong>${escapeHtml(promoterName)}</strong>,
    </p>
    <p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:1.6;">
      váš e-mail byl úspěšně ověřen. Jsme rádi, že jste s námi!
    </p>
    <p style="margin:0 0 24px;color:#374151;font-size:15px;line-height:1.6;">
      Dalším krokem je vytvoření vašeho promotérského profilu. Připravte si tyto informace:
    </p>
    <ul style="margin:0 0 24px;padding-left:20px;color:#374151;font-size:15px;line-height:1.8;">
      <li>Název vaší firmy nebo organizace</li>
      <li>IČO (8 číslic)</li>
      <li>Kontaktní telefon</li>
      <li>Webové stránky (volitelné)</li>
    </ul>
    <p style="margin:0;color:#374151;font-size:15px;line-height:1.6;">
      Přihlaste se do platformy a vyplňte svůj profil. Poté budete moci odeslat KYC dokumenty a začít prodávat vstupenky.
    </p>`;
  return { subject, html: baseLayout(subject, body) };
}

/**
 * Template 3: KYC submitted confirmation for promoter
 * Subject: "KYC dokumenty přijaty — čekáme na schválení"
 */
export function kycSubmittedPromoterEmail(promoterName: string): { subject: string; html: string } {
  const subject = 'KYC dokumenty přijaty — čekáme na schválení';
  const body = `
    <h2 style="margin:0 0 16px;color:#1a1a2e;font-size:22px;">KYC dokumenty přijaty</h2>
    <p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:1.6;">
      Dobrý den, <strong>${escapeHtml(promoterName)}</strong>,
    </p>
    <p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:1.6;">
      vaše KYC dokumenty byly úspěšně přijaty a čekají na schválení naším týmem.
    </p>
    <table cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 24px;background-color:#f0fdf4;border-left:4px solid #22c55e;border-radius:4px;">
      <tr>
        <td style="padding:16px 20px;">
          <p style="margin:0;color:#15803d;font-size:14px;font-weight:600;">Odhadovaná doba zpracování</p>
          <p style="margin:4px 0 0;color:#166534;font-size:14px;">1–3 pracovní dny</p>
        </td>
      </tr>
    </table>
    <p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:1.6;">
      O výsledku vás budeme informovat e-mailem. V případě potřeby vás může náš tým kontaktovat pro doplňující informace.
    </p>
    <p style="margin:0;color:#374151;font-size:15px;line-height:1.6;">
      Děkujeme za vaši trpělivost.
    </p>`;
  return { subject, html: baseLayout(subject, body) };
}

/**
 * Template 4: KYC approved — account activation email
 * Subject: "Váš účet byl aktivován! 🎉"
 */
export function kycApprovedEmail(promoterName: string, dashboardUrl: string): { subject: string; html: string } {
  const subject = 'Váš účet byl aktivován! 🎉';
  const body = `
    <h2 style="margin:0 0 16px;color:#1a1a2e;font-size:22px;">Váš účet byl aktivován!</h2>
    <p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:1.6;">
      Dobrý den, <strong>${escapeHtml(promoterName)}</strong>,
    </p>
    <p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:1.6;">
      gratulujeme! Vaše KYC dokumenty byly úspěšně ověřeny a váš promotérský účet je nyní aktivní.
    </p>
    <p style="margin:0 0 32px;color:#374151;font-size:15px;line-height:1.6;">
      Nyní můžete začít vytvářet události, spravovat vstupenky a prodávat přes platformu Tixly.
    </p>
    <table cellpadding="0" cellspacing="0" style="margin:0 0 32px;">
      <tr>
        <td style="background-color:#22c55e;border-radius:6px;">
          <a href="${escapeHtml(dashboardUrl)}" style="display:inline-block;padding:14px 28px;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;">
            Přejít na dashboard
          </a>
        </td>
      </tr>
    </table>
    <p style="margin:0;color:#6b7280;font-size:13px;line-height:1.5;">
      Pokud máte jakékoli otázky, neváhejte kontaktovat náš tým podpory.
    </p>`;
  return { subject, html: baseLayout(subject, body) };
}

/**
 * Template 5: KYC rejected email
 * Subject: "KYC ověření — potřebujeme doplnění"
 */
export function kycRejectedEmail(promoterName: string, reason: string): { subject: string; html: string } {
  const subject = 'KYC ověření — potřebujeme doplnění';
  const body = `
    <h2 style="margin:0 0 16px;color:#1a1a2e;font-size:22px;">KYC ověření — doplnění informací</h2>
    <p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:1.6;">
      Dobrý den, <strong>${escapeHtml(promoterName)}</strong>,
    </p>
    <p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:1.6;">
      po přezkoumání vašich KYC dokumentů jsme zjistili, že je potřeba doplnit nebo opravit následující:
    </p>
    <table cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 24px;background-color:#fef2f2;border-left:4px solid #ef4444;border-radius:4px;">
      <tr>
        <td style="padding:16px 20px;">
          <p style="margin:0;color:#991b1b;font-size:14px;font-weight:600;">Důvod zamítnutí</p>
          <p style="margin:8px 0 0;color:#7f1d1d;font-size:14px;line-height:1.6;">${escapeHtml(reason)}</p>
        </td>
      </tr>
    </table>
    <p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:1.6;">
      Prosím, přihlaste se do platformy, opravte uvedené nedostatky a odešlete KYC dokumenty znovu.
    </p>
    <p style="margin:0;color:#374151;font-size:15px;line-height:1.6;">
      V případě dotazů nás kontaktujte na podpora@tixly.cz.
    </p>`;
  return { subject, html: baseLayout(subject, body) };
}

/**
 * Template 6: Admin KYC notification
 * Subject: "Nový KYC k review: {promoterName}"
 */
export function adminKycNotificationEmail(
  promoterName: string,
  promoterId: string,
  adminUrl: string,
): { subject: string; html: string } {
  const subject = `Nový KYC k review: ${promoterName}`;
  const body = `
    <h2 style="margin:0 0 16px;color:#1a1a2e;font-size:22px;">Nový KYC k review</h2>
    <p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:1.6;">
      Promotér <strong>${escapeHtml(promoterName)}</strong> odeslal KYC dokumenty a čeká na schválení.
    </p>
    <table cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 24px;background-color:#f0f9ff;border-left:4px solid #0ea5e9;border-radius:4px;">
      <tr>
        <td style="padding:16px 20px;">
          <p style="margin:0;color:#075985;font-size:14px;font-weight:600;">Promoter ID</p>
          <p style="margin:4px 0 0;color:#0c4a6e;font-size:13px;font-family:monospace;">${escapeHtml(promoterId)}</p>
        </td>
      </tr>
    </table>
    <table cellpadding="0" cellspacing="0" style="margin:0 0 32px;">
      <tr>
        <td style="background-color:#4f46e5;border-radius:6px;">
          <a href="${escapeHtml(adminUrl)}" style="display:inline-block;padding:14px 28px;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;">
            Přejít na admin panel
          </a>
        </td>
      </tr>
    </table>
    <p style="margin:0;color:#6b7280;font-size:13px;line-height:1.5;">
      Tato notifikace byla odeslána automaticky systémem Tixly.
    </p>`;
  return { subject, html: baseLayout(subject, body) };
}

/**
 * Template 7: New ticket sale notification for promoter
 * Subject: "Nový prodej: {ticketCount}× vstupenka na {eventName}"
 */
export interface NewTicketSaleEmailResult {
  subject: string;
  html: string;
}

export function newTicketSaleEmail(
  promoterName: string,
  eventName: string,
  ticketCount: number,
  grossAmountHalire: number,
  orderId: string,
  dashboardUrl: string,
): NewTicketSaleEmailResult {
  const subject = `Nový prodej: ${ticketCount}× vstupenka na ${escapeHtml(eventName)}`;
  const formattedAmount = formatCzk(grossAmountHalire);
  const body = `
    <h2 style="margin:0 0 16px;color:#1a1a2e;font-size:22px;">Nový prodej vstupenek 🎉</h2>
    <p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:1.6;">
      Dobrý den, <strong>${escapeHtml(promoterName)}</strong>,
    </p>
    <p style="margin:0 0 24px;color:#374151;font-size:15px;line-height:1.6;">
      gratulujeme! Právě se prodaly vstupenky na akci <strong>${escapeHtml(eventName)}</strong>.
    </p>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;background-color:#f0fdf4;border:1px solid #bbf7d0;border-radius:6px;">
      <tr>
        <td style="padding:20px;">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="color:#374151;font-size:14px;padding:8px 0;">Počet prodaných vstupenek:</td>
              <td align="right" style="color:#16a34a;font-size:16px;font-weight:700;padding:8px 0;">${ticketCount} ks</td>
            </tr>
            <tr>
              <td style="color:#374151;font-size:14px;padding:8px 0;">Hrubá částka:</td>
              <td align="right" style="color:#16a34a;font-size:16px;font-weight:700;padding:8px 0;">${escapeHtml(formattedAmount)}</td>
            </tr>
            <tr>
              <td style="color:#374151;font-size:14px;padding:8px 0;">Číslo objednávky:</td>
              <td align="right" style="color:#111827;font-size:14px;font-weight:600;font-family:monospace;padding:8px 0;">${escapeHtml(orderId)}</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
    <p style="margin:0 0 24px;color:#374151;font-size:15px;line-height:1.6;">
      Podrobnosti o prodeji a finančního přehledu naleznete v paměťovém prostředí.
    </p>
    <table cellpadding="0" cellspacing="0" style="margin:0 0 32px;">
      <tr>
        <td style="background-color:#16a34a;border-radius:6px;">
          <a href="${escapeHtml(dashboardUrl)}" style="display:inline-block;padding:14px 28px;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;">
            Přejít na dashboard
          </a>
        </td>
      </tr>
    </table>
    <p style="margin:0;color:#6b7280;font-size:13px;line-height:1.5;">
      Děkujeme za využívání platformy Tixly.
    </p>`;
  return { subject, html: baseLayout(subject, body) };
}

/**
 * Template 8: Upcoming event reminder (~48 hours before event)
 * Subject: "Připomínka: {eventName} se koná zítra"
 */
export interface UpcomingEventReminderEmailResult {
  subject: string;
  html: string;
}

export function upcomingEventReminderEmail(
  promoterName: string,
  eventName: string,
  eventDateFormatted: string,
  venueName: string,
  ticketsSold: number,
  totalCapacity: number,
  dashboardUrl: string,
): UpcomingEventReminderEmailResult {
  const subject = `Připomínka: ${escapeHtml(eventName)} se koná zítra`;
  const percentageSold = Math.round((ticketsSold / totalCapacity) * 100);
  const body = `
    <h2 style="margin:0 0 16px;color:#1a1a2e;font-size:22px;">Příměť: Vaše akce se koná zítra!</h2>
    <p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:1.6;">
      Dobrý den, <strong>${escapeHtml(promoterName)}</strong>,
    </p>
    <p style="margin:0 0 24px;color:#374151;font-size:15px;line-height:1.6;">
      připomínáme vám, že vaše akce <strong>${escapeHtml(eventName)}</strong> se koná zítra!
    </p>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;background-color:#fffbeb;border:1px solid #fed7aa;border-radius:6px;">
      <tr>
        <td style="padding:20px;">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="color:#374151;font-size:14px;padding:8px 0;"><strong>Název akce:</strong></td>
              <td align="right" style="color:#111827;font-size:14px;font-weight:600;padding:8px 0;">${escapeHtml(eventName)}</td>
            </tr>
            <tr>
              <td style="color:#374151;font-size:14px;padding:8px 0;"><strong>Datum a čas:</strong></td>
              <td align="right" style="color:#111827;font-size:14px;font-weight:600;padding:8px 0;">${escapeHtml(eventDateFormatted)}</td>
            </tr>
            <tr>
              <td style="color:#374151;font-size:14px;padding:8px 0;"><strong>Místo konání:</strong></td>
              <td align="right" style="color:#111827;font-size:14px;font-weight:600;padding:8px 0;">${escapeHtml(venueName)}</td>
            </tr>
            <tr>
              <td colspan="2" style="padding:12px 0 4px 0;">
                <p style="margin:0;color:#374151;font-size:14px;">Prodané vstupenky:</p>
              </td>
            </tr>
            <tr>
              <td colspan="2" style="padding:4px 0 12px 0;">
                <p style="margin:0;color:#111827;font-size:14px;"><strong>${ticketsSold} / ${totalCapacity} vstupenek prodáno</strong> (${percentageSold}%)</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
    <p style="margin:0 0 24px;color:#374151;font-size:15px;line-height:1.6;">
      Ujistěte se, že vše je připraveno. Podrobnosti o akci a obsazenosti naleznete v dashboardu.
    </p>
    <table cellpadding="0" cellspacing="0" style="margin:0 0 32px;">
      <tr>
        <td style="background-color:#f59e0b;border-radius:6px;">
          <a href="${escapeHtml(dashboardUrl)}" style="display:inline-block;padding:14px 28px;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;">
            Přejít na dashboard
          </a>
        </td>
      </tr>
    </table>
    <p style="margin:0;color:#6b7280;font-size:13px;line-height:1.5;">
      Přejeme vám úspěšnou akci!
    </p>`;
  return { subject, html: baseLayout(subject, body) };
}
