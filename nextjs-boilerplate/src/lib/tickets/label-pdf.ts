/**
 * Label PDF renderer — TIŠTĚNÁ vstupenka ve fixním formátu ~15×5 cm (à la
 * SMSticket / Zebra GK420d / TSC DA210), jeden lístek = jedna stránka.
 *
 * Na rozdíl od [[tickets/pdf-renderer]] (A4 print-at-home) je tohle určené pro
 * box-office termotiskárnu se štítkovým kartonem. Layout je landscape, QR nese
 * krátký podepsaný PRINT TOKEN (viz [[tickets/print-token]]), který odbaví náš
 * scanner ID-based cestou (offline-friendly, statický).
 *
 * Rozměr 152×51 mm odpovídá běžné rolce ticketového kartonu. Tiskne se přes
 * ovladač termotiskárny s médiem nastaveným na "152mm × 51mm / Actual size".
 *
 * Knihovny: pdfkit + qrcode (čistý JS). Noto fonty kvůli české diakritice.
 */
import { join } from 'node:path';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { signEventPrintToken, signPrintToken } from './print-token';

const FONT_DIR = join(process.cwd(), 'src', 'lib', 'tickets', 'fonts');
const FONT_REGULAR = join(FONT_DIR, 'NotoSans-Regular.ttf');
const FONT_BOLD = join(FONT_DIR, 'NotoSans-Bold.ttf');

const MM = 2.834645669; // pt per mm
const PAGE_W = 152 * MM; // ≈ 430.9 pt
const PAGE_H = 51 * MM; // ≈ 144.6 pt
const PAD = 10;
const QR_SIZE = 108; // ≈ 38 mm

const DEFAULT_BRAND_COLOR = '#10b981';

export interface LabelTicket {
  ticketId: string;
  ticketTypeName: string;
  seatLabel?: string | null;
  /** Cena v haléřích — vytiskne se kategorie+cena jako na SMSticket lístku */
  unitPriceHalire?: number | null;
}

export interface LabelHeader {
  eventTitle: string;
  eventDateStart: string | null;
  venueName: string | null;
  buyerName: string;
  promoterName?: string | null;
  brandColorHex?: string | null;
  /** Akce vstupenek — s ní se tiskne token TXP2 vázaný na akci (kolo 4), jinak TXP1. */
  eventId?: string | null;
}

function isValidHex(c: string | null | undefined): c is string {
  return typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c);
}

function formatCzk(halire: number): string {
  return `${(halire / 100).toLocaleString('cs-CZ', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })} Kč`;
}

export async function renderTicketLabelPdf(
  header: LabelHeader,
  tickets: LabelTicket[],
): Promise<Buffer> {
  const doc = new PDFDocument({ size: [PAGE_W, PAGE_H], margin: 0 });
  doc.registerFont('main', FONT_REGULAR);
  doc.registerFont('bold', FONT_BOLD);
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));

  const brandColor = isValidHex(header.brandColorHex) ? header.brandColorHex : DEFAULT_BRAND_COLOR;
  const productionMode = process.env.TICKET_PDF_PRODUCTION_MODE === '1';

  const textW = PAGE_W - PAD * 2 - QR_SIZE - 8; // levý sloupec šířka
  const dateStr = header.eventDateStart
    ? new Date(header.eventDateStart).toLocaleString('cs-CZ', {
        dateStyle: 'medium',
        timeStyle: 'short',
      })
    : 'Termín bude upřesněn';

  for (let i = 0; i < tickets.length; i++) {
    if (i > 0) doc.addPage();
    const t = tickets[i];

    // Brand pruh nahoře + jméno promotéra
    doc.rect(0, 0, PAGE_W, 5).fill(brandColor);
    doc.font('bold').fontSize(11).fillColor(brandColor)
      .text(header.promoterName ?? 'Tixly', PAD, 12, { width: textW });

    // Levý sloupec — text
    let y = 30;
    doc.font('bold').fontSize(13).fillColor('#111')
      .text(header.eventTitle, PAD, y, { width: textW, lineGap: -1, ellipsis: true, height: 32 });
    y = Math.max(doc.y, y + 16) + 2;

    doc.font('main').fontSize(8.5).fillColor('#444');
    doc.text(dateStr, PAD, y, { width: textW });
    y = doc.y;
    doc.text(header.venueName ?? 'Online / TBD', PAD, y, { width: textW, ellipsis: true });
    y = doc.y + 4;

    // Typ vstupenky (+ cena) — zvýrazněně
    doc.font('bold').fontSize(11).fillColor('#111');
    const typeLine = t.unitPriceHalire != null
      ? `${t.ticketTypeName} · ${formatCzk(t.unitPriceHalire)}`
      : t.ticketTypeName;
    doc.text(typeLine, PAD, y, { width: textW, ellipsis: true });
    y = doc.y;

    if (t.seatLabel) {
      doc.font('main').fontSize(9).fillColor('#333')
        .text(t.seatLabel, PAD, y, { width: textW, ellipsis: true });
      y = doc.y;
    }

    // Spodní řádek: držitel + (demo varování / token id)
    doc.font('main').fontSize(7).fillColor('#888')
      .text(
        productionMode
          ? `Držitel: ${header.buyerName}`
          : `DEMO · neslouží k reálnému vstupu · ${header.buyerName}`,
        PAD,
        PAGE_H - 16,
        { width: textW, ellipsis: true },
      );

    // Pravý sloupec — QR s print tokenem
    // Kolo 4: TXP2 (vstupenka + akce) skener přijme i pod qr_policy rotating_24h.
    const token = header.eventId ? signEventPrintToken(t.ticketId, header.eventId) : signPrintToken(t.ticketId);
    const qrPng = await QRCode.toBuffer(token, {
      errorCorrectionLevel: 'M',
      margin: 0,
      width: 300,
    });
    const qrX = PAGE_W - PAD - QR_SIZE;
    const qrY = 16;
    doc.image(qrPng, qrX, qrY, { width: QR_SIZE, height: QR_SIZE });
    doc.font('main').fontSize(6).fillColor('#999')
      .text(t.ticketId.slice(0, 8), qrX, qrY + QR_SIZE + 2, {
        width: QR_SIZE,
        align: 'center',
      });
  }

  doc.end();
  return new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
}
