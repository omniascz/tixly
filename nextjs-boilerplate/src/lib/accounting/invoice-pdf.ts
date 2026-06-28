/**
 * PDF faktura — PDFKit renderer.
 *
 * Formát A4, česky, NotoSans (plná diakritika).
 * Přijímá stejný IsdocInvoiceData jako ISDOC builder → konzistentní data.
 */

import { join } from 'node:path';
import PDFDocument from 'pdfkit';
import type { IsdocInvoiceData } from './isdoc';

const FONT_DIR = join(process.cwd(), 'src', 'lib', 'tickets', 'fonts');
const FONT_REGULAR = join(FONT_DIR, 'NotoSans-Regular.ttf');
const FONT_BOLD = join(FONT_DIR, 'NotoSans-Bold.ttf');

const MARGIN = 50;
const PAGE_W = 595.28; // A4 points
const COL_R = PAGE_W - MARGIN;

function fmtMoney(amount: number, currency: string): string {
  return new Intl.NumberFormat('cs-CZ', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(amount);
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('cs-CZ');
}

export function buildInvoicePdf(d: IsdocInvoiceData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: MARGIN, info: { Title: `Faktura ${d.invoiceNumber}` } });
    doc.registerFont('Regular', FONT_REGULAR);
    doc.registerFont('Bold', FONT_BOLD);

    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // ── Header ─────────────────────────────────────────────────────────────
    doc.font('Bold').fontSize(18).text('FAKTURA', MARGIN, MARGIN);
    doc.font('Regular').fontSize(10)
      .text(`Číslo: ${d.invoiceNumber}`, MARGIN, MARGIN + 24)
      .text(`Datum vystavení: ${fmtDate(d.issueDate)}`)
      .text(`DUZP: ${fmtDate(d.taxableSupplyDate)}`)
      .text(`Datum splatnosti: ${fmtDate(d.dueDate)}`);

    // ── Supplier / Customer ────────────────────────────────────────────────
    const blockTop = MARGIN + 90;
    doc.font('Bold').fontSize(10).text('Dodavatel', MARGIN, blockTop);
    doc.font('Regular').fontSize(9)
      .text(d.supplier.name, MARGIN, blockTop + 14)
      .text(d.supplier.address.street)
      .text(`${d.supplier.address.zip} ${d.supplier.address.city}`)
      .text(`IČO: ${d.supplier.ico}`)
      .text(d.supplier.dic ? `DIČ: ${d.supplier.dic}` : '');
    if (d.supplier.bankAccount) doc.text(`Účet: ${d.supplier.bankAccount}`);
    if (d.supplier.email) doc.text(d.supplier.email);

    const custX = PAGE_W / 2;
    doc.font('Bold').fontSize(10).text('Odběratel', custX, blockTop);
    doc.font('Regular').fontSize(9)
      .text(d.customer.name, custX, blockTop + 14)
      .text(d.customer.address?.street ?? '', custX)
      .text(
        d.customer.address ? `${d.customer.address.zip ?? ''} ${d.customer.address.city ?? ''}`.trim() : '',
        custX,
      )
      .text(d.customer.ico ? `IČO: ${d.customer.ico}` : '', custX)
      .text(d.customer.dic ? `DIČ: ${d.customer.dic}` : '', custX)
      .text(d.customer.email ?? '', custX);

    // ── Line items table ───────────────────────────────────────────────────
    const tableTop = blockTop + 130;
    const colW = [220, 50, 90, 60, 90];
    const colX = [MARGIN, MARGIN + 220, MARGIN + 270, MARGIN + 360, MARGIN + 420];
    const headers = ['Popis', 'Množství', 'Jedn. cena', 'DPH %', 'Celkem'];

    // Table header
    doc.font('Bold').fontSize(9);
    doc.rect(MARGIN, tableTop - 4, COL_R - MARGIN, 18).fill('#f0f0f0').stroke('#cccccc');
    doc.fill('#000000');
    headers.forEach((h, i) => {
      doc.text(h, colX[i], tableTop, { width: colW[i], align: i === 0 ? 'left' : 'right' });
    });

    // Table rows
    doc.font('Regular').fontSize(9);
    let rowY = tableTop + 20;
    for (const line of d.lines) {
      const lineTotal = line.quantity * line.unitPriceWithoutVat * (1 + line.vatRatePct / 100);
      const vals = [
        line.description,
        String(line.quantity),
        fmtMoney(line.unitPriceWithoutVat, d.currency),
        `${line.vatRatePct} %`,
        fmtMoney(lineTotal, d.currency),
      ];
      vals.forEach((v, i) => {
        doc.text(v, colX[i], rowY, { width: colW[i], align: i === 0 ? 'left' : 'right' });
      });
      rowY += 16;
      doc.moveTo(MARGIN, rowY - 2).lineTo(COL_R, rowY - 2).stroke('#e0e0e0');
    }

    // ── Totals ─────────────────────────────────────────────────────────────
    const totalsX = PAGE_W - MARGIN - 200;
    rowY += 10;
    doc.font('Regular').fontSize(9)
      .text('Základ daně:', totalsX, rowY, { width: 120, align: 'left' })
      .text(fmtMoney(d.subtotal, d.currency), totalsX + 120, rowY, { width: 80, align: 'right' });
    rowY += 14;
    doc.text('DPH:', totalsX, rowY, { width: 120, align: 'left' })
      .text(fmtMoney(d.vatAmount, d.currency), totalsX + 120, rowY, { width: 80, align: 'right' });
    rowY += 14;
    doc.font('Bold').fontSize(10)
      .text('Celkem k úhradě:', totalsX, rowY, { width: 120, align: 'left' })
      .text(fmtMoney(d.total, d.currency), totalsX + 120, rowY, { width: 80, align: 'right' });

    // ── Payment info ───────────────────────────────────────────────────────
    if (d.variableSymbol || d.supplier.bankAccount) {
      rowY += 30;
      doc.font('Bold').fontSize(9).text('Platební instrukce:', MARGIN, rowY);
      doc.font('Regular').fontSize(9);
      rowY += 14;
      if (d.supplier.bankAccount) doc.text(`Číslo účtu: ${d.supplier.bankAccount}`, MARGIN, rowY);
      if (d.variableSymbol) {
        rowY += 12;
        doc.text(`Variabilní symbol: ${d.variableSymbol}`, MARGIN, rowY);
      }
      if (d.supplier.iban) {
        rowY += 12;
        doc.text(`IBAN: ${d.supplier.iban}`, MARGIN, rowY);
      }
    }

    // ── Footer ─────────────────────────────────────────────────────────────
    doc.fontSize(7).fillColor('#888888')
      .text(
        'Doklad byl vygenerován systémem Tixly.',
        MARGIN,
        doc.page.height - MARGIN - 10,
        { width: COL_R - MARGIN, align: 'center' },
      );

    doc.end();
  });
}
