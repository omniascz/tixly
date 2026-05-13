// ---------------------------------------------------------------------------
// HTML e-mailové šablony pro modul mikro-pořadatele
// Styl: tabulkové rozvržení kompatibilní s e-mailovými klienty
// ---------------------------------------------------------------------------

const BRAND_COLOR = '#6C47FF';
const BRAND_NAME = 'Tixly';

function baseLayout(title: string, bodyContent: string): string {
  return `<!DOCTYPE html>
<html lang="cs">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f4f7;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f4f4f7;">
    <tr>
      <td align="center" style="padding:40px 10px;">
        <table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">

          <!-- Hlavička -->
          <tr>
            <td align="center" style="background-color:${BRAND_COLOR};padding:32px 40px;">
              <span style="color:#ffffff;font-size:24px;font-weight:700;letter-spacing:-0.5px;">${BRAND_NAME}</span>
            </td>
          </tr>

          <!-- Obsah -->
          <tr>
            <td style="padding:40px 40px 32px;">
              ${bodyContent}
            </td>
          </tr>

          <!-- Patička -->
          <tr>
            <td style="background-color:#f9f9fb;padding:24px 40px;border-top:1px solid #e8e8ee;">
              <p style="margin:0;font-size:12px;color:#9a9ab0;text-align:center;">
                © ${new Date().getFullYear()} ${BRAND_NAME} s.r.o. &nbsp;·&nbsp; Všechna práva vyhrazena<br />
                <a href="https://tixly.cz" style="color:${BRAND_COLOR};text-decoration:none;">tixly.cz</a>
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

function ctaButton(url: string, label: string): string {
  return `<table cellpadding="0" cellspacing="0" border="0" style="margin:32px 0;">
    <tr>
      <td align="center" bgcolor="${BRAND_COLOR}" style="border-radius:6px;">
        <a href="${url}"
           style="display:inline-block;padding:14px 32px;font-size:16px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:6px;">
          ${label}
        </a>
      </td>
    </tr>
  </table>`;
}

// ---------------------------------------------------------------------------
// Šablona 1 — Ověření e-mailu
// ---------------------------------------------------------------------------
export function microOrganizerVerificationEmail(
  email: string,
  verificationUrl: string,
): string {
  const body = `
    <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#1a1a2e;">Ověřte svůj e-mail</h1>
    <p style="margin:0 0 16px;font-size:15px;color:#4a4a6a;line-height:1.6;">
      Děkujeme za registraci v ${BRAND_NAME}! Klikněte na tlačítko níže a aktivujte svůj účet.
    </p>
    <p style="margin:0 0 8px;font-size:14px;color:#4a4a6a;">
      Registrujete se jako: <strong>${email}</strong>
    </p>
    ${ctaButton(verificationUrl, 'Ověřit e-mail')}
    <p style="margin:0;font-size:13px;color:#9a9ab0;line-height:1.5;">
      Platnost odkazu vyprší za <strong>24 hodin</strong>.<br />
      Pokud jste se neregistrovali, tento e-mail ignorujte.
    </p>
    <hr style="border:none;border-top:1px solid #e8e8ee;margin:32px 0 24px;" />
    <p style="margin:0;font-size:12px;color:#9a9ab0;">
      Odkaz nefunguje? Zkopírujte ho do prohlížeče:<br />
      <span style="color:${BRAND_COLOR};word-break:break-all;">${verificationUrl}</span>
    </p>`;

  return baseLayout('Ověřte svůj e-mail — Tixly', body);
}

// ---------------------------------------------------------------------------
// Šablona 2 — Vítejte + odkaz na první akci
// ---------------------------------------------------------------------------
export function microOrganizerWelcomeEmail(
  name: string,
  firstEventUrl: string,
): string {
  const body = `
    <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#1a1a2e;">Vítejte, ${name}! 🎉</h1>
    <p style="margin:0 0 16px;font-size:15px;color:#4a4a6a;line-height:1.6;">
      Váš účet v ${BRAND_NAME} je aktivní. Jste připraveni pořádat akce jednoduše a rychle.
    </p>
    <p style="margin:0 0 24px;font-size:15px;color:#4a4a6a;line-height:1.6;">
      Vaše první akce je online. Sdílejte odkaz se svými hosty a začněte prodávat vstupenky!
    </p>
    ${ctaButton(firstEventUrl, 'Zobrazit moji akci')}
    <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#f4f4f7;border-radius:6px;margin-top:8px;">
      <tr>
        <td style="padding:16px 20px;">
          <p style="margin:0 0 6px;font-size:13px;font-weight:600;color:#4a4a6a;">Co vás čeká dál?</p>
          <ul style="margin:0;padding:0 0 0 18px;font-size:13px;color:#4a4a6a;line-height:1.8;">
            <li>Sledujte prodeje v přehledu akcí</li>
            <li>Přidejte další akce (max 3 aktivní na bezplatném účtu)</li>
            <li>Upgradujte na plný účet pro výplaty a neomezené akce</li>
          </ul>
        </td>
      </tr>
    </table>`;

  return baseLayout('Vítejte v Tixly!', body);
}

// ---------------------------------------------------------------------------
// Šablona 3 — Akce je živá, sdílejte odkaz
// ---------------------------------------------------------------------------
export function eventPublishedEmail(
  name: string,
  eventName: string,
  ticketUrl: string,
): string {
  const body = `
    <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#1a1a2e;">Vaše akce je online!</h1>
    <p style="margin:0 0 16px;font-size:15px;color:#4a4a6a;line-height:1.6;">
      Ahoj <strong>${name}</strong>, akce <strong>${eventName}</strong> byla úspěšně zveřejněna.
    </p>
    <p style="margin:0 0 8px;font-size:15px;color:#4a4a6a;line-height:1.6;">
      Sdílejte odkaz na vstupenky se svými hosty:
    </p>
    ${ctaButton(ticketUrl, 'Otevřít stránku akce')}
    <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#f4f4f7;border-radius:6px;">
      <tr>
        <td style="padding:16px 20px;">
          <p style="margin:0 0 4px;font-size:12px;font-weight:600;color:#9a9ab0;text-transform:uppercase;letter-spacing:0.5px;">Odkaz na vstupenky</p>
          <p style="margin:0;font-size:13px;color:${BRAND_COLOR};word-break:break-all;">${ticketUrl}</p>
        </td>
      </tr>
    </table>
    <p style="margin:24px 0 0;font-size:13px;color:#9a9ab0;line-height:1.5;">
      Přehled prodejů najdete ve svém účtu na <a href="https://app.tixly.cz" style="color:${BRAND_COLOR};text-decoration:none;">app.tixly.cz</a>.
    </p>`;

  return baseLayout(`Akce „${eventName}" je online — Tixly`, body);
}
