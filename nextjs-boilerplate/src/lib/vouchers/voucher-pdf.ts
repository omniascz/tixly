/**
 * Voucher PDF renderer — dárkový poukaz s brandingem promotéra.
 *
 * Layout:
 *   - Brand color hlavička
 *   - Velký nadpis "Dárkový poukaz" / "Gift voucher"
 *   - Hodnota poukazu (large display)
 *   - Voucher code (monospace, viditelný)
 *   - QR kód s code (pro pohodlné skenování)
 *   - Expirace + jméno příjemce (pokud zadáno)
 *   - Logo promotéra (pokud nahrané přes brand_logo_url)
 *   - Footer s návodem na uplatnění
 *
 * Brand color + logo z platform.promoters.brand_color_hex + brand_logo_url.
 * Logo: max 80×80px, downloaded HTTP fetch s 3s timeout (graceful fallback).
 */
import { join } from 'node:path';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';

const FONT_DIR = join(process.cwd(), 'src', 'lib', 'tickets', 'fonts');
const FONT_REGULAR = join(FONT_DIR, 'NotoSans-Regular.ttf');
const FONT_BOLD = join(FONT_DIR, 'NotoSans-Bold.ttf');

const DEFAULT_BRAND_COLOR = '#10b981';

export interface VoucherPdfData {
  code: string;
  amountHalire: number;
  balanceHalire: number;
  currency: string;
  promoterName: string;
  brandColorHex: string | null;
  brandLogoUrl: string | null;
  issuedToName?: string | null;
  issuedToEmail?: string | null;
  message?: string | null;
  expiresAt?: string | null;
  locale?: 'cs' | 'sk' | 'en';
}

const STRINGS = {
  cs: {
    title: 'Dárkový poukaz',
    value: 'Hodnota',
    code: 'Kód poukazu',
    expires: 'Platí do',
    forever: 'bez expirace',
    issuedTo: 'Pro',
    redemption: 'Jak uplatnit',
    redemption_steps: [
      '1. Navštivte stránku pořadatele',
      '2. Vyberte si akci',
      '3. Při placení zadejte kód poukazu',
      '4. Sleva se odečte z celkové ceny',
    ],
    issued_via: 'Vystaveno přes Tixly',
    partial_use: 'Poukaz lze uplatnit částečně — zbytek zůstane k pozdějšímu použití.',
    balance_note: 'Aktuální zůstatek',
  },
  sk: {
    title: 'Darčekový poukaz',
    value: 'Hodnota',
    code: 'Kód poukazu',
    expires: 'Platí do',
    forever: 'bez expirácie',
    issuedTo: 'Pre',
    redemption: 'Ako uplatniť',
    redemption_steps: [
      '1. Navštívte stránku organizátora',
      '2. Vyberte si akciu',
      '3. Pri platbe zadajte kód poukazu',
      '4. Zľava sa odpočíta z celkovej ceny',
    ],
    issued_via: 'Vystavené cez Tixly',
    partial_use: 'Poukaz možno uplatniť čiastočne — zvyšok ostane na neskôr.',
    balance_note: 'Aktuálny zostatok',
  },
  en: {
    title: 'Gift Voucher',
    value: 'Value',
    code: 'Voucher code',
    expires: 'Valid until',
    forever: 'no expiration',
    issuedTo: 'For',
    redemption: 'How to redeem',
    redemption_steps: [
      '1. Visit the organizer’s page',
      '2. Pick an event',
      '3. Enter the voucher code at checkout',
      '4. Discount applies to the total',
    ],
    issued_via: 'Issued via Tixly',
    partial_use: 'Voucher can be used partially — remaining balance stays for later.',
    balance_note: 'Current balance',
  },
} as const;

function isValidHex(c: string | null | undefined): c is string {
  return typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c);
}

function formatMoney(halire: number, currency: string, locale: string): string {
  const kc = halire / 100;
  return new Intl.NumberFormat(locale === 'sk' ? 'sk-SK' : locale === 'en' ? 'en-US' : 'cs-CZ', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(kc);
}

async function fetchLogoSafely(url: string): Promise<Buffer | null> {
  try {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 3000);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const ct = res.headers.get('content-type') ?? '';
    if (!/png|jpeg|jpg/i.test(ct)) return null;
    const buf = await res.arrayBuffer();
    if (buf.byteLength > 500_000) return null; // 500kb max
    return Buffer.from(buf);
  } catch {
    return null;
  }
}

export async function renderVoucherPdf(data: VoucherPdfData): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 48 });
  doc.registerFont('main', FONT_REGULAR);
  doc.registerFont('bold', FONT_BOLD);
  doc.font('main');
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));

  const brandColor = isValidHex(data.brandColorHex) ? data.brandColorHex : DEFAULT_BRAND_COLOR;
  const locale = data.locale ?? 'cs';
  const t = STRINGS[locale] ?? STRINGS.cs;

  // 1. Brand hlavička (větší pruh než ticket, 60px)
  doc.rect(0, 0, doc.page.width, 60).fill(brandColor);

  // Promotér logo (vlevo) — fetch async
  const logoBuf = data.brandLogoUrl ? await fetchLogoSafely(data.brandLogoUrl) : null;
  if (logoBuf) {
    try {
      doc.image(logoBuf, 48, 12, { fit: [36, 36] });
    } catch {
      // pdfkit nepodporuje formát — fallback na text
    }
  }

  doc.fontSize(20).fillColor('#fff').font('bold').text(data.promoterName, 96, 22, { width: 400 });

  doc.fillColor('#111').font('main');

  // 2. Velký title
  doc.moveDown(4);
  doc.fontSize(32).font('bold').fillColor(brandColor).text(t.title, { align: 'center' });
  doc.moveDown(0.5);

  // 3. Hodnota (velký display)
  const isPartiallyUsed = data.balanceHalire < data.amountHalire;
  doc.font('bold').fontSize(60).fillColor('#111').text(
    formatMoney(isPartiallyUsed ? data.balanceHalire : data.amountHalire, data.currency, locale),
    { align: 'center' },
  );
  if (isPartiallyUsed) {
    doc.fontSize(11).fillColor('#666').font('main').text(
      `${t.balance_note} — ${t.value}: ${formatMoney(data.amountHalire, data.currency, locale)}`,
      { align: 'center' },
    );
  }
  doc.moveDown(1.5);

  // 4. Voucher code box + QR
  const codeBoxY = doc.y;
  doc.rect(80, codeBoxY, doc.page.width - 160, 110).fillAndStroke('#fafafa', '#e5e5e5');

  doc.fontSize(10).fillColor('#666').font('main').text(t.code, 100, codeBoxY + 14);
  doc.fontSize(26).fillColor('#111').font('bold').text(data.code, 100, codeBoxY + 32, {
    characterSpacing: 2,
  });

  // QR vpravo
  const qrPng = await QRCode.toBuffer(data.code, {
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 90,
  });
  doc.image(qrPng, doc.page.width - 180, codeBoxY + 10, { width: 90, height: 90 });
  doc.y = codeBoxY + 120;

  // 5. Pro koho (volitelné)
  if (data.issuedToName ?? data.issuedToEmail) {
    doc.moveDown(0.5);
    doc.fontSize(11).fillColor('#666').font('main').text(`${t.issuedTo}: `, { continued: true });
    doc.fillColor('#111').font('bold').text(
      data.issuedToName ?? data.issuedToEmail ?? '',
    );
    doc.font('main');
  }

  // 6. Osobní zpráva (volitelná)
  if (data.message) {
    doc.moveDown(0.5);
    doc.fontSize(11).fillColor('#444').text(`„${data.message}"`, {
      align: 'center',
      width: doc.page.width - 96,
    });
  }

  // 7. Expirace
  doc.moveDown(0.8);
  doc.fontSize(10).fillColor('#666').text(
    `${t.expires}: ${data.expiresAt ? new Date(data.expiresAt).toLocaleDateString(locale === 'sk' ? 'sk-SK' : 'cs-CZ') : t.forever}`,
    { align: 'center' },
  );

  // 8. Jak uplatnit
  doc.moveDown(1.5);
  doc.fontSize(12).fillColor('#111').font('bold').text(t.redemption);
  doc.fontSize(10).fillColor('#444').font('main');
  for (const line of t.redemption_steps) {
    doc.text(line, { indent: 12 });
  }
  doc.moveDown(0.5);
  doc.fontSize(9).fillColor('#999').text(t.partial_use);

  // 9. Footer
  const footerY = doc.page.height - 60;
  doc.fontSize(8).fillColor('#bbb').text(t.issued_via, 48, footerY, { align: 'center' });

  doc.end();
  return new Promise((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
}
