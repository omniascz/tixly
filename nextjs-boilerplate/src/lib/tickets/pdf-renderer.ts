/**
 * PDF ticket renderer — generuje jeden PDF dokument se všemi lístky
 * objednávky a daňovým souhrnem na poslední stránce.
 *
 * Každý lístek = stránka A4 s:
 *   - Branding promotéra (logo + barva hlavičky)
 *   - Název akce, datum, místo
 *   - Typ vstupenky
 *   - QR (otpauth:// URI pro TOTP scanner)
 *
 * Poslední stránka = daňový rozpis (DPH 10 % standardně pro kulturní akce,
 * konfigurovatelné přes `vatRatePct` v hlavičce).
 *
 * Knihovny: pdfkit + qrcode (čistý JS, žádný headless Chrome).
 *
 * Demo warning ("neslouží k reálnému vstupu") se skryje, když je
 * `process.env.TICKET_PDF_PRODUCTION_MODE === '1'`.
 */

import { join } from 'node:path';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';

// NotoSans-Regular/Bold (Open Font License, latin-ext = plné české znaky).
// Bez vlastního TTF by default pdfkit Helvetica zlomil diakritiku na boxy.
const FONT_DIR = join(process.cwd(), 'src', 'lib', 'tickets', 'fonts');
const FONT_REGULAR = join(FONT_DIR, 'NotoSans-Regular.ttf');
const FONT_BOLD = join(FONT_DIR, 'NotoSans-Bold.ttf');

export interface TicketPdfData {
  ticketId: string;
  ticketTypeName: string;
  totpSecretBase32: string;
  /** otpauth label (typically holderEmail) */
  holderLabel: string;
  /** otpauth issuer (typically event title) */
  issuer: string;
  /** Cena lístku v haléřích (pro daňový rozpis) */
  unitPriceHalire?: number;
  /** Sektor/řada/sedadlo pro seated lístek */
  seatLabel?: string | null;
}

export interface PdfHeader {
  eventTitle: string;
  eventDateStart: string;
  venueName: string | null;
  buyerName: string;
  buyerEmail: string;
  orderId: string;
  /** Brand promotéra — pokud null, fallback na výchozí zelený header */
  promoterName?: string | null;
  brandColorHex?: string | null;
  brandLogoUrl?: string | null;
  /** Sazba DPH v procentech (10 = kulturní akce, 21 = standardní) */
  vatRatePct?: number;
}

const DEFAULT_BRAND_COLOR = '#10b981';
const DEFAULT_VAT_RATE_PCT = 10; // Kulturní akce v ČR

function isValidHex(c: string | null | undefined): c is string {
  return typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c);
}

export async function renderTicketsPdf(
  header: PdfHeader,
  tickets: TicketPdfData[],
): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 48 });
  doc.registerFont('main', FONT_REGULAR);
  doc.registerFont('bold', FONT_BOLD);
  doc.font('main');
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));

  const brandColor = isValidHex(header.brandColorHex)
    ? header.brandColorHex
    : DEFAULT_BRAND_COLOR;
  const vatRatePct = header.vatRatePct ?? DEFAULT_VAT_RATE_PCT;
  const productionMode = process.env.TICKET_PDF_PRODUCTION_MODE === '1';

  for (let i = 0; i < tickets.length; i++) {
    if (i > 0) doc.addPage();
    const t = tickets[i];

    // Hlavička: brand color pruh nahoře + jméno promotéra (nebo Tixly)
    const headerName = header.promoterName ?? 'Tixly';
    doc.rect(0, 0, doc.page.width, 8).fill(brandColor);
    doc.fontSize(20).fillColor(brandColor).text(headerName, 48, 28, { align: 'left' });
    if (!productionMode) {
      doc.fontSize(9).fillColor('#999').text(
        'Demo vstupenka · neslouží k reálnému vstupu',
        48, 52,
      );
    } else {
      doc.fontSize(9).fillColor('#666').text(
        `Lístek vystaven přes Tixly · ${header.orderId.slice(0, 8)}`,
        48, 52,
      );
    }
    doc.moveDown(2);

    // Title
    doc.fontSize(18).fillColor('#111').text(header.eventTitle);
    doc.moveDown(0.3);

    const date = new Date(header.eventDateStart).toLocaleString('cs-CZ', {
      dateStyle: 'long',
      timeStyle: 'short',
    });
    doc.fontSize(11).fillColor('#444').text(`Datum: ${date}`);
    doc.text(`Místo: ${header.venueName ?? 'Online / TBD'}`);
    doc.moveDown(0.8);

    // Holder
    doc.fontSize(10).fillColor('#666').text('Držitel');
    doc.fontSize(13).fillColor('#111').text(header.buyerName);
    doc.fontSize(10).fillColor('#666').text(header.buyerEmail);
    doc.moveDown(0.5);

    // Ticket type + seat
    doc.fontSize(10).fillColor('#666').text('Typ vstupenky');
    doc.fontSize(14).fillColor('#111').text(t.ticketTypeName);
    if (t.seatLabel) {
      doc.fontSize(11).fillColor('#444').text(`Sedadlo: ${t.seatLabel}`);
    }
    doc.moveDown(0.5);

    // QR code (otpauth URI)
    const otpauthUri = buildOtpauthUri({
      label: t.holderLabel,
      issuer: t.issuer,
      secretBase32: t.totpSecretBase32,
    });
    const qrPng = await QRCode.toBuffer(otpauthUri, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 220,
    });

    const qrY = doc.y + 10;
    doc.image(qrPng, doc.page.width / 2 - 110, qrY, { width: 220, height: 220 });
    doc.y = qrY + 230;

    // Footer info
    doc.fontSize(9).fillColor('#666').text(`Lístek: ${t.ticketId}`, { align: 'center' });
    doc.fontSize(9).fillColor('#666').text(`Objednávka: ${header.orderId}`, { align: 'center' });

    doc.moveDown(1).fontSize(8).fillColor('#999').text(
      'Při vstupu předložte tento PDF lístek (QR scanner). Lístek je vázaný na držitele a není přenosný.',
      { align: 'center' },
    );
  }

  // Daňový souhrn — poslední stránka, pokud máme cenové údaje
  const itemsWithPrices = tickets.filter((t) => typeof t.unitPriceHalire === 'number');
  if (itemsWithPrices.length > 0) {
    doc.addPage();
    doc.rect(0, 0, doc.page.width, 8).fill(brandColor);
    doc.fontSize(20).fillColor(brandColor).text(header.promoterName ?? 'Tixly', 48, 28);
    doc.fontSize(9).fillColor('#666').text(
      productionMode ? 'Daňový doklad' : 'Daňový doklad (demo)',
      48, 52,
    );
    doc.moveDown(2);

    doc.fontSize(16).fillColor('#111').text('Daňový rozpis');
    doc.moveDown(0.5);
    doc.fontSize(10).fillColor('#666').text(`Akce: ${header.eventTitle}`);
    doc.text(`Kupec: ${header.buyerName} (${header.buyerEmail})`);
    doc.text(`Objednávka: ${header.orderId}`);
    doc.text(`Vystaveno: ${new Date().toLocaleDateString('cs-CZ')}`);
    doc.moveDown();

    // Tabulka
    const colX = { name: 48, qty: 320, unit: 370, total: 470 };
    const tableY0 = doc.y;
    doc.fontSize(10).fillColor('#666');
    doc.text('Položka', colX.name, tableY0);
    doc.text('Ks', colX.qty, tableY0);
    doc.text('Cena/ks (s DPH)', colX.unit, tableY0);
    doc.text('Celkem', colX.total, tableY0);
    doc.moveTo(48, tableY0 + 14).lineTo(550, tableY0 + 14).stroke('#ddd');
    doc.y = tableY0 + 18;

    // Sloučit lístky stejného typu
    const grouped = new Map<string, { qty: number; unit: number }>();
    for (const t of itemsWithPrices) {
      const key = t.ticketTypeName;
      const prev = grouped.get(key) ?? { qty: 0, unit: t.unitPriceHalire ?? 0 };
      prev.qty += 1;
      grouped.set(key, prev);
    }

    let totalGross = 0;
    for (const [name, { qty, unit }] of grouped) {
      const lineY = doc.y;
      doc.fontSize(11).fillColor('#111').text(name, colX.name, lineY);
      doc.text(String(qty), colX.qty, lineY);
      doc.text(formatCzk(unit), colX.unit, lineY);
      doc.text(formatCzk(unit * qty), colX.total, lineY);
      totalGross += unit * qty;
      doc.moveDown(0.5);
    }

    doc.moveDown(0.3);
    doc.moveTo(320, doc.y).lineTo(550, doc.y).stroke('#ddd');
    doc.moveDown(0.4);

    // Rozpis daně: gross = net * (1 + vat/100)  →  net = gross / (1 + vat/100)
    const netHalire = Math.round(totalGross / (1 + vatRatePct / 100));
    const vatHalire = totalGross - netHalire;

    const rowY = (label: string, value: string, bold = false) => {
      const y = doc.y;
      doc.fontSize(11).fillColor('#444');
      if (bold) doc.font('bold').fillColor('#111');
      else doc.font('main');
      doc.text(label, 320, y);
      doc.text(value, colX.total, y);
      doc.font('main');
      doc.moveDown(0.4);
    };
    rowY('Základ daně:', formatCzk(netHalire));
    rowY(`DPH ${vatRatePct} %:`, formatCzk(vatHalire));
    rowY('Celkem k úhradě:', formatCzk(totalGross), true);

    doc.moveDown(1);
    doc.fontSize(8).fillColor('#666').text(
      vatRatePct === 10
        ? 'Snížená sazba DPH 10 % se vztahuje na vstupné na divadelní, hudební a obdobné kulturní akce (§ 47 zákona o DPH).'
        : `Sazba DPH ${vatRatePct} %.`,
      48,
      undefined,
      { width: 500 },
    );
  }

  doc.end();
  const unsigned = await new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  // X.509 PAdES signing (volitelné — bez P12 cert nebo signpdf knihovny vrátí
  // nepodepsaný PDF). Failure nesmí shodit vystavení vstupenek.
  try {
    const { signPdfIfConfigured } = await import('./pdf-sign');
    const result = await signPdfIfConfigured(unsigned);
    return result.buffer;
  } catch (err) {
    console.warn('[pdf-renderer] signing skipped:', err);
    return unsigned;
  }
}

function formatCzk(halire: number): string {
  return `${(halire / 100).toLocaleString('cs-CZ', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })} Kč`;
}

function buildOtpauthUri(input: {
  label: string;
  issuer: string;
  secretBase32: string;
}): string {
  const enc = (s: string) => encodeURIComponent(s);
  const label = `${enc(input.issuer)}:${enc(input.label)}`;
  const params = new URLSearchParams({
    secret: input.secretBase32,
    issuer: input.issuer,
    algorithm: 'SHA1',
    digits: '6',
    period: '30',
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
