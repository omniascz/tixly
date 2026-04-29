/**
 * Demo PDF ticket renderer — generuje jeden PDF dokument se všemi lístky
 * objednávky. Každý lístek = jedna stránka A4 s:
 *   - Název akce, datum, místo
 *   - Typ vstupenky
 *   - Identifikátor lístku (krátký), TOTP QR (otpauth:// URI)
 *
 * Knihovny: pdfkit + qrcode (čistý JS, žádný headless Chrome).
 */

import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';

export interface TicketPdfData {
  ticketId: string;
  ticketTypeName: string;
  totpSecretBase32: string;
  /** otpauth label (typically holderEmail) */
  holderLabel: string;
  /** otpauth issuer (typically event title) */
  issuer: string;
}

export interface PdfHeader {
  eventTitle: string;
  eventDateStart: string;
  venueName: string | null;
  buyerName: string;
  buyerEmail: string;
  orderId: string;
}

export async function renderTicketsPdf(
  header: PdfHeader,
  tickets: TicketPdfData[],
): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 48 });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));

  for (let i = 0; i < tickets.length; i++) {
    if (i > 0) doc.addPage();
    const t = tickets[i]!;

    // Hlavička
    doc.fontSize(22).fillColor('#10b981').text('Tixly', { align: 'left' });
    doc.fontSize(10).fillColor('#666').text('Demo vstupenka · neslouží k reálnému vstupu');
    doc.moveDown(1);

    // Title
    doc.fontSize(18).fillColor('#111').text(header.eventTitle);
    doc.moveDown(0.3);

    const date = new Date(header.eventDateStart).toLocaleString('cs-CZ', {
      dateStyle: 'long',
      timeStyle: 'short',
    });
    doc.fontSize(11).fillColor('#444').text(`📅  ${date}`);
    doc.text(`📍  ${header.venueName ?? 'Online / TBD'}`);
    doc.moveDown(0.8);

    // Holder
    doc.fontSize(11).fillColor('#666').text('Držitel');
    doc.fontSize(13).fillColor('#111').text(header.buyerName);
    doc.fontSize(11).fillColor('#666').text(header.buyerEmail);
    doc.moveDown(0.5);

    // Ticket type
    doc.fontSize(11).fillColor('#666').text('Typ vstupenky');
    doc.fontSize(14).fillColor('#111').text(t.ticketTypeName);
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
    doc.fontSize(10).fillColor('#666').text(`Lístek: ${t.ticketId}`, { align: 'center' });
    doc.text(`Objednávka: ${header.orderId}`, { align: 'center' });

    doc
      .moveDown(1.5)
      .fontSize(9)
      .fillColor('#999')
      .text(
        'Při vstupu předložte tento PDF lístek (QR scanner). Lístek je vázaný na držitele a není přenosný.',
        { align: 'center' },
      );
  }

  doc.end();
  return await new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
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
