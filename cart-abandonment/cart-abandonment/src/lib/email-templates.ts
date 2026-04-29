// Cart abandonment email templates — Czech, table-based HTML.
// Tři stupně sekvenční kampaně: 30 min / 24h / 72h.

interface Stage1Input { firstName: string; itemSummary: string; recoveryUrl: string; }
interface Stage2Input { firstName: string; itemSummary: string; recoveryUrl: string; eventStartingSoon?: boolean; }
interface Stage3Input { firstName: string; itemSummary: string; recoveryUrl: string; discountCode: string; discountPct: number; }

interface RenderedEmail { subject: string; html: string; }

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function wrap(bodyInner: string): string {
  return `<!DOCTYPE html>
<html lang="cs"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#111827">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f3f4f6">
  <tr><td align="center" style="padding:24px">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff;border-radius:8px;overflow:hidden;max-width:600px">
      <tr><td style="padding:32px">
        ${bodyInner}
      </td></tr>
      <tr><td style="padding:16px 32px;background:#f9fafb;border-top:1px solid #e5e7eb;font-size:12px;color:#6b7280" align="center">
        Tixly &middot; <a href="{{unsubscribeUrl}}" style="color:#6b7280">Odhlásit odběr</a>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

function ctaButton(url: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0"><tr><td style="border-radius:6px;background:#2563eb"><a href="${url}" style="display:inline-block;padding:14px 28px;color:#ffffff;text-decoration:none;font-weight:600;font-size:16px">${label}</a></td></tr></table>`;
}

// ---------------------------------------------------------------------------
// Stage 1 — 30 minutes: "you forgot something"
// ---------------------------------------------------------------------------
export function abandonStage1Email(input: Stage1Input): RenderedEmail {
  const name = escapeHtml(input.firstName || 'ahoj');
  const items = escapeHtml(input.itemSummary);
  const subject = 'Zapomněl/a jsi něco v košíku?';
  const html = wrap(`
    <h1 style="margin:0 0 16px;font-size:24px;color:#111827">Ahoj ${name},</h1>
    <p style="margin:0 0 16px;font-size:16px;line-height:1.5">všimli jsme si, že jsi v košíku nechal/a vstupenky — a nestihl/a jsi dokončit objednávku.</p>
    <p style="margin:0 0 8px;font-size:14px;color:#4b5563"><strong>Tvůj výběr:</strong></p>
    <p style="margin:0 0 16px;font-size:15px;color:#111827">${items}</p>
    <p style="margin:0;font-size:16px;line-height:1.5">Stačí jedno kliknutí a můžeš pokračovat tam, kde jsi skončil/a.</p>
    ${ctaButton(input.recoveryUrl, 'Dokončit objednávku')}
    <p style="margin:0;font-size:13px;color:#6b7280">Odkaz je platný 7 dní. Vstupenky v košíku nejsou rezervovány.</p>
  `);
  return { subject, html };
}

// ---------------------------------------------------------------------------
// Stage 2 — 24 hours: "still interested?"
// ---------------------------------------------------------------------------
export function abandonStage2Email(input: Stage2Input): RenderedEmail {
  const name = escapeHtml(input.firstName || 'ahoj');
  const items = escapeHtml(input.itemSummary);
  const subject = input.eventStartingSoon
    ? 'Akce se blíží — máš stále zájem?'
    : 'Máš stále zájem o vstupenky?';
  const urgency = input.eventStartingSoon
    ? '<p style="margin:0 0 16px;padding:12px 16px;background:#fef3c7;border-left:4px solid #f59e0b;color:#92400e;font-size:14px">Pozor — akce se blíží a vstupenky mohou být brzy vyprodány.</p>'
    : '';
  const html = wrap(`
    <h1 style="margin:0 0 16px;font-size:24px;color:#111827">Ahoj ${name},</h1>
    <p style="margin:0 0 16px;font-size:16px;line-height:1.5">včera jsi začal/a s objednávkou, ale ještě jsi ji nedokončil/a. Stále máš zájem?</p>
    ${urgency}
    <p style="margin:0 0 8px;font-size:14px;color:#4b5563"><strong>Tvůj košík:</strong></p>
    <p style="margin:0 0 16px;font-size:15px;color:#111827">${items}</p>
    ${ctaButton(input.recoveryUrl, 'Pokračovat k platbě')}
    <p style="margin:0;font-size:13px;color:#6b7280">Pokud už o vstupenky nemáš zájem, můžeš tento e-mail ignorovat.</p>
  `);
  return { subject, html };
}

// ---------------------------------------------------------------------------
// Stage 3 — 72 hours: "last chance + discount"
// ---------------------------------------------------------------------------
export function abandonStage3Email(input: Stage3Input): RenderedEmail {
  const name = escapeHtml(input.firstName || 'ahoj');
  const items = escapeHtml(input.itemSummary);
  const code = escapeHtml(input.discountCode);
  const pct = input.discountPct;
  const subject = `Poslední šance — sleva ${pct} % jen pro tebe`;
  const html = wrap(`
    <h1 style="margin:0 0 16px;font-size:24px;color:#111827">Ahoj ${name},</h1>
    <p style="margin:0 0 16px;font-size:16px;line-height:1.5">víme, že se rozhoduješ — tak pro tebe máme něco navíc. Připravili jsme ti jednorázovou slevu <strong>${pct} %</strong> na tvůj košík.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:16px 0"><tr><td align="center" style="padding:20px;background:#ecfdf5;border:2px dashed #10b981;border-radius:8px">
      <p style="margin:0 0 4px;font-size:13px;color:#065f46;text-transform:uppercase;letter-spacing:1px">Tvůj slevový kód</p>
      <p style="margin:0;font-size:28px;font-weight:700;color:#065f46;letter-spacing:2px">${code}</p>
    </td></tr></table>
    <p style="margin:0 0 8px;font-size:14px;color:#4b5563"><strong>Tvůj košík:</strong></p>
    <p style="margin:0 0 16px;font-size:15px;color:#111827">${items}</p>
    ${ctaButton(input.recoveryUrl, 'Uplatnit slevu a dokončit')}
    <p style="margin:0;font-size:13px;color:#6b7280">Kód je jednorázový a platí 48 hodin. Po uplynutí tvůj košík uzavřeme.</p>
  `);
  return { subject, html };
}
