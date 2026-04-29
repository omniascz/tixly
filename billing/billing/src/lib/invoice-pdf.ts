/**
 * Invoice PDF generation — PDFKit-based A4 invoice for payout/platform fees.
 *
 * Ported from @acc/documents pdf.ts, adapted for Tixly payout context.
 * Platform = seller (supplier), Promoter = buyer (customer).
 * All amounts in haléře (integer).
 */

import PDFDocument from 'pdfkit';
import { getLabels, formatDate as i18nFormatDate, formatAmountHalire, type InvoiceLocale } from './i18n.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface InvoicePdfLine {
  description: string;
  quantity: number;
  unit?: string;
  /** Unit price in haléře */
  unitPriceHalire: number;
  /** VAT rate percentage (e.g. 21, 12, 0) */
  vatRatePercent: number;
  /** Line subtotal (base) in haléře */
  subtotalHalire: number;
  /** VAT amount in haléře */
  vatHalire: number;
  /** Line total (subtotal + VAT) in haléře */
  totalHalire: number;
}

export interface InvoicePdfData {
  invoiceNumber: string;
  issueDate: string;        // YYYY-MM-DD
  taxDate?: string;
  dueDate?: string;
  variableSymbol?: string;
  locale?: InvoiceLocale;
  isCreditNote?: boolean;

  // Seller (platform)
  sellerName: string;
  sellerIco: string;
  sellerDic?: string;
  sellerAddress: string;    // multi-line
  sellerBankAccount?: string;

  // Buyer (promoter)
  buyerName: string;
  buyerIco?: string;
  buyerDic?: string;
  buyerAddress: string;

  currency: string;
  lines: InvoicePdfLine[];

  /** Document totals in haléře */
  subtotalHalire: number;
  vatTotalHalire: number;
  totalHalire: number;

  /** VAT breakdown by rate */
  vatBreakdown?: Array<{ ratePercent: number; baseHalire: number; vatHalire: number }>;

  /** Optional QR payment code (base64 PNG) */
  qrCodeBase64?: string;

  notes?: string;
}

// ---------------------------------------------------------------------------
// PDF Generation
// ---------------------------------------------------------------------------

/**
 * Generate an A4 invoice PDF as Buffer.
 */
export async function generateInvoicePdf(data: InvoicePdfData): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    const doc = new PDFDocument({ size: 'A4', margin: 50 });

    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const locale: InvoiceLocale = data.locale ?? 'cs';
    const labels = getLabels(locale);
    const fmtDate = (d: string) => i18nFormatDate(d, locale);
    const fmtAmt = (h: number) => formatAmountHalire(h, data.currency);

    const pageWidth = doc.page.width - 100;
    const leftX = 50;
    const rightX = doc.page.width / 2 + 10;
    const colWidth = (pageWidth - 20) / 2;

    // ---- Header ----
    const title = data.isCreditNote ? labels.creditNote : labels.invoice;
    doc.font('Helvetica-Bold').fontSize(24).text(title, leftX, 50);
    doc.font('Helvetica').fontSize(14).text(data.invoiceNumber, leftX, 78);

    // Dates on the right
    let dateY = 50;
    doc.font('Helvetica-Bold').fontSize(10).text(`${labels.issueDate}:`, 380, dateY, { width: 80 });
    doc.font('Helvetica').fontSize(10).text(fmtDate(data.issueDate), 470, dateY, { width: 80 });
    dateY += 16;

    if (data.taxDate) {
      doc.font('Helvetica-Bold').fontSize(10).text(`${labels.taxDate}:`, 380, dateY, { width: 80 });
      doc.font('Helvetica').fontSize(10).text(fmtDate(data.taxDate), 470, dateY, { width: 80 });
      dateY += 16;
    }

    if (data.dueDate) {
      doc.font('Helvetica-Bold').fontSize(10).text(`${labels.dueDate}:`, 380, dateY, { width: 80 });
      doc.font('Helvetica').fontSize(10).text(fmtDate(data.dueDate), 470, dateY, { width: 80 });
      dateY += 16;
    }

    if (data.variableSymbol) {
      doc.font('Helvetica-Bold').fontSize(10).text(`${labels.variableSymbol}:`, 380, dateY, { width: 80 });
      doc.font('Helvetica').fontSize(10).text(data.variableSymbol, 470, dateY, { width: 80 });
    }

    // Separator
    const afterHeaderY = 115;
    doc.moveTo(leftX, afterHeaderY).lineTo(leftX + pageWidth, afterHeaderY).strokeColor('#cccccc').stroke();

    // ---- Seller / Buyer ----
    const partnerY = afterHeaderY + 12;

    // Seller (left)
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#555555').text(labels.supplier, leftX, partnerY);
    let sellerY = partnerY + 16;
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#000000').text(data.sellerName, leftX, sellerY, { width: colWidth });
    sellerY += doc.currentLineHeight(true) + 4;

    doc.font('Helvetica').fontSize(9);
    for (const line of data.sellerAddress.split('\n')) {
      if (line.trim()) {
        doc.text(line, leftX, sellerY, { width: colWidth });
        sellerY += doc.currentLineHeight(true) + 2;
      }
    }

    doc.fontSize(9).text(`${labels.ico}: ${data.sellerIco}`, leftX, sellerY, { width: colWidth });
    sellerY += doc.currentLineHeight(true) + 2;
    if (data.sellerDic) {
      doc.text(`${labels.dic}: ${data.sellerDic}`, leftX, sellerY, { width: colWidth });
      sellerY += doc.currentLineHeight(true) + 2;
    }
    if (data.sellerBankAccount) {
      doc.font('Helvetica-Bold').fontSize(9).text(`${labels.bankAccount}: ${data.sellerBankAccount}`, leftX, sellerY, { width: colWidth });
      sellerY += doc.currentLineHeight(true) + 2;
    }

    // Buyer (right)
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#555555').text(labels.customer, rightX, partnerY);
    let buyerY = partnerY + 16;
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#000000').text(data.buyerName, rightX, buyerY, { width: colWidth });
    buyerY += doc.currentLineHeight(true) + 4;

    doc.font('Helvetica').fontSize(9);
    for (const line of data.buyerAddress.split('\n')) {
      if (line.trim()) {
        doc.text(line, rightX, buyerY, { width: colWidth });
        buyerY += doc.currentLineHeight(true) + 2;
      }
    }

    if (data.buyerIco) {
      doc.text(`${labels.ico}: ${data.buyerIco}`, rightX, buyerY, { width: colWidth });
      buyerY += doc.currentLineHeight(true) + 2;
    }
    if (data.buyerDic) {
      doc.text(`${labels.dic}: ${data.buyerDic}`, rightX, buyerY, { width: colWidth });
    }

    // ---- Lines table ----
    const tableTopY = Math.max(sellerY, buyerY) + 30;
    doc.moveTo(leftX, tableTopY - 5).lineTo(leftX + pageWidth, tableTopY - 5).strokeColor('#cccccc').stroke();

    const cols = tableColumns(leftX, pageWidth);
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#555555');
    renderTableRow(doc, tableTopY, cols, [
      labels.description, labels.quantity, labels.unit, labels.unitPrice,
      labels.vatRate, labels.subtotal, labels.vatAmount, labels.total,
    ]);

    doc.moveTo(leftX, tableTopY + 14).lineTo(leftX + pageWidth, tableTopY + 14).strokeColor('#cccccc').stroke();

    let rowY = tableTopY + 18;
    doc.font('Helvetica').fontSize(8).fillColor('#000000');

    for (const line of data.lines) {
      renderTableRow(doc, rowY, cols, [
        line.description,
        String(line.quantity),
        line.unit ?? '',
        fmtAmt(line.unitPriceHalire),
        `${line.vatRatePercent}%`,
        fmtAmt(line.subtotalHalire),
        fmtAmt(line.vatHalire),
        fmtAmt(line.totalHalire),
      ]);
      rowY += 16;
    }

    // ---- VAT breakdown ----
    const breakdownX = leftX + pageWidth - 200;
    let breakdownY = rowY + 16;

    doc.moveTo(leftX, breakdownY - 8).lineTo(leftX + pageWidth, breakdownY - 8).strokeColor('#cccccc').stroke();

    if (data.vatBreakdown && data.vatBreakdown.length > 0) {
      doc.font('Helvetica-Bold').fontSize(8).fillColor('#555555');
      doc.text(labels.vatRate, breakdownX, breakdownY, { width: 50 });
      doc.text(labels.subtotalLabel, breakdownX + 55, breakdownY, { width: 70 });
      doc.text(labels.vatLabel, breakdownX + 130, breakdownY, { width: 70 });
      breakdownY += 14;

      doc.font('Helvetica').fontSize(8).fillColor('#000000');
      for (const vat of data.vatBreakdown) {
        doc.text(`${vat.ratePercent}%`, breakdownX, breakdownY, { width: 50 });
        doc.text(fmtAmt(vat.baseHalire), breakdownX + 55, breakdownY, { width: 70 });
        doc.text(fmtAmt(vat.vatHalire), breakdownX + 130, breakdownY, { width: 70 });
        breakdownY += 12;
      }
      breakdownY += 6;
    }

    // ---- Totals ----
    const totalX = leftX + pageWidth - 200;
    let totalY = breakdownY + 4;

    doc.font('Helvetica').fontSize(9).fillColor('#000000');
    doc.text(`${labels.subtotalLabel}:`, totalX, totalY, { width: 120 });
    doc.text(fmtAmt(data.subtotalHalire), totalX + 125, totalY, { width: 75, align: 'right' });
    totalY += 14;

    doc.text(`${labels.vatLabel}:`, totalX, totalY, { width: 120 });
    doc.text(fmtAmt(data.vatTotalHalire), totalX + 125, totalY, { width: 75, align: 'right' });
    totalY += 14;

    doc.moveTo(totalX, totalY - 2).lineTo(leftX + pageWidth, totalY - 2).strokeColor('#000000').stroke();

    doc.font('Helvetica-Bold').fontSize(12).fillColor('#000000');
    doc.text(`${labels.totalLabel}:`, totalX, totalY + 2, { width: 120 });
    doc.text(fmtAmt(data.totalHalire), totalX + 125, totalY + 2, { width: 75, align: 'right' });

    // ---- QR code ----
    let footerY = totalY + 40;

    if (data.qrCodeBase64) {
      try {
        const qrBuffer = Buffer.from(data.qrCodeBase64, 'base64');
        doc.image(qrBuffer, leftX, footerY, { width: 100, height: 100 });
        footerY += 110;
      } catch {
        // Skip QR if image fails
      }
    }

    // ---- Footer ----
    if (data.notes) {
      doc.font('Helvetica-Bold').fontSize(9).text(`${labels.notes}:`, leftX, footerY);
      footerY += 14;
      doc.font('Helvetica').fontSize(9).text(data.notes, leftX, footerY, { width: pageWidth });
      footerY += doc.heightOfString(data.notes, { width: pageWidth }) + 8;
    }

    if (data.sellerBankAccount) {
      doc.font('Helvetica-Bold').fontSize(9).text(`${labels.bankAccount}:`, leftX, footerY);
      footerY += 14;
      doc.font('Helvetica').fontSize(9).text(data.sellerBankAccount, leftX, footerY, { width: 200 });
      footerY += 14;
    }

    if (data.dueDate) {
      doc.font('Helvetica-Bold').fontSize(9).text(`${labels.dueDate}: ${fmtDate(data.dueDate)}`, leftX, footerY);
    }

    doc.end();
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface ColDef { x: number; width: number }

function tableColumns(leftX: number, pageWidth: number): ColDef[] {
  const widths = [130, 40, 25, 65, 30, 65, 55, 70];
  const cols: ColDef[] = [];
  let x = leftX;
  for (const w of widths) {
    cols.push({ x, width: w });
    x += w;
  }
  const last = cols[cols.length - 1];
  if (last) last.width = leftX + pageWidth - last.x;
  return cols;
}

function renderTableRow(
  doc: InstanceType<typeof PDFDocument>,
  y: number,
  cols: ColDef[],
  cells: string[],
): void {
  for (let i = 0; i < cols.length; i++) {
    const col = cols[i];
    const cell = cells[i] ?? '';
    if (!col) continue;
    const align = i === 0 ? 'left' : 'right';
    doc.text(cell, col.x, y, { width: col.width - 2, align });
  }
}
