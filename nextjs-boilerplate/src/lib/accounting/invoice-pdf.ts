/**
 * PDF daňového dokladu — PDFKit, A4, česky (NotoSans).
 *
 * Kolo 7 (C-54): vstup je jednotný model TaxDocument (stejný jako pro ISDOC), takže PDF a ISDOC
 * nemohou ukazovat jiná čísla. Plátce: rozpis základ / DPH / celkem po jednotlivých sazbách.
 * Neplátce: bez DPH, s textem „Prodávající není plátcem DPH". Dobropis: „Opravný daňový doklad"
 * se zápornými částkami a odkazem na opravovaný doklad.
 */

import { join } from 'node:path';
import PDFDocument from 'pdfkit';
import { NON_PAYER_NOTE, type TaxDocument } from './tax-document';

const FONT_DIR = join(process.cwd(), 'src', 'lib', 'tickets', 'fonts');
const FONT_REGULAR = join(FONT_DIR, 'NotoSans-Regular.ttf');
const FONT_BOLD = join(FONT_DIR, 'NotoSans-Bold.ttf');

const MARGIN = 50;
const PAGE_W = 595.28; // A4 points
const COL_R = PAGE_W - MARGIN;

export function fmtMinor(minor: number, currency: string): string {
  return new Intl.NumberFormat('cs-CZ', { style: 'currency', currency, minimumFractionDigits: 2 }).format(minor / 100);
}

function fmtDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${Number(d)}. ${Number(m)}. ${y}`;
}

/** Titulek dokladu podle druhu a plátcovství prodávajícího. */
export function documentTitle(d: Pick<TaxDocument, 'docType' | 'supplier'>): string {
  if (d.docType === 'credit_note') return d.supplier.vatPayer ? 'OPRAVNÝ DAŇOVÝ DOKLAD (DOBROPIS)' : 'OPRAVNÝ DOKLAD (DOBROPIS)';
  return d.supplier.vatPayer ? 'DAŇOVÝ DOKLAD' : 'DOKLAD';
}

export function buildInvoicePdf(d: TaxDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const title = documentTitle(d);
    const doc = new PDFDocument({ size: 'A4', margin: MARGIN, info: { Title: `${title} ${d.number}` } });
    doc.registerFont('Regular', FONT_REGULAR);
    doc.registerFont('Bold', FONT_BOLD);

    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // ── Hlavička ───────────────────────────────────────────────────────────
    doc.font('Bold').fontSize(16).text(title, MARGIN, MARGIN);
    doc.font('Regular').fontSize(10).text(`Číslo: ${d.number}`, MARGIN, MARGIN + 24).text(`Datum vystavení: ${fmtDate(d.issueDate)}`);
    if (d.supplier.vatPayer) doc.text(`Datum uskutečnění zdanitelného plnění: ${fmtDate(d.taxableSupplyDate)}`);
    if (d.correctedDocument) {
      doc.text(`Opravuje doklad: ${d.correctedDocument.number} ze dne ${fmtDate(d.correctedDocument.issueDate)}`);
      doc.text('Důvod opravy: vrácení vstupného (refund)');
    }
    if (d.docType === 'invoice') doc.text(d.paid ? 'Uhrazeno' : `Datum splatnosti: ${fmtDate(d.dueDate)}`);

    // ── Prodávající / kupující ─────────────────────────────────────────────
    const blockTop = MARGIN + 120;
    const s = d.supplier;
    doc.font('Bold').fontSize(10).text('Prodávající', MARGIN, blockTop);
    doc.font('Regular').fontSize(9).text(s.name, MARGIN, blockTop + 14);
    if (s.address) doc.text(s.address.street).text(`${s.address.zip} ${s.address.city}`.trim());
    if (s.ico) doc.text(`IČO: ${s.ico}`);
    if (s.vatPayer && s.dic) doc.text(`DIČ: ${s.dic}`);
    if (s.bankAccount) doc.text(`Účet: ${s.bankAccount}`);
    if (s.email) doc.text(s.email);

    const custX = PAGE_W / 2;
    const c = d.customer;
    doc.font('Bold').fontSize(10).text('Kupující', custX, blockTop);
    doc.font('Regular').fontSize(9).text(c.name, custX, blockTop + 14);
    if (c.address) doc.text(c.address.street, custX).text(`${c.address.zip} ${c.address.city}`.trim(), custX);
    if (c.ico) doc.text(`IČO: ${c.ico}`, custX);
    if (c.dic) doc.text(`DIČ: ${c.dic}`, custX);
    if (c.email) doc.text(c.email, custX);

    // ── Položky ────────────────────────────────────────────────────────────
    const tableTop = blockTop + 120;
    const colX = [MARGIN, MARGIN + 260, MARGIN + 330, MARGIN + 410];
    const colW = [260, 70, 80, 85];
    const headers = s.vatPayer ? ['Položka', 'Množství', 'Sazba DPH', 'Celkem vč. DPH'] : ['Položka', 'Množství', '', 'Celkem'];
    doc.font('Bold').fontSize(9);
    doc.rect(MARGIN, tableTop - 4, COL_R - MARGIN, 18).fill('#f0f0f0');
    doc.fill('#000000');
    headers.forEach((h, i) => doc.text(h, colX[i], tableTop, { width: colW[i], align: i === 0 ? 'left' : 'right' }));
    doc.font('Regular').fontSize(9);
    let y = tableTop + 20;
    for (const it of d.items) {
      const vals = [it.description, String(it.quantity), it.ratePct !== null ? `${it.ratePct} %` : '', fmtMinor(it.totalMinor, d.currency)];
      vals.forEach((v, i) => doc.text(v, colX[i], y, { width: colW[i], align: i === 0 ? 'left' : 'right' }));
      y += 16;
    }

    // ── Rekapitulace DPH po sazbách / součet ────────────────────────────────
    y += 12;
    if (s.vatPayer) {
      doc.font('Bold').fontSize(9).text('Rekapitulace DPH', MARGIN, y);
      y += 14;
      const rx = [MARGIN, MARGIN + 120, MARGIN + 240, MARGIN + 360];
      ['Sazba', 'Základ daně', 'DPH', 'Celkem'].forEach((h, i) => doc.text(h, rx[i], y, { width: 110, align: i === 0 ? 'left' : 'right' }));
      doc.font('Regular');
      for (const l of d.vatLines) {
        y += 14;
        [`${l.ratePct} %`, fmtMinor(l.baseMinor, d.currency), fmtMinor(l.vatMinor, d.currency), fmtMinor(l.totalMinor, d.currency)]
          .forEach((v, i) => doc.text(v, rx[i], y, { width: 110, align: i === 0 ? 'left' : 'right' }));
      }
      y += 20;
    }
    doc.font('Bold').fontSize(11).text(d.docType === 'credit_note' ? 'Celkem k vrácení:' : 'Celkem:', MARGIN + 240, y, { width: 120 })
      .text(fmtMinor(d.totalMinor, d.currency), MARGIN + 360, y, { width: 110, align: 'right' });

    if (!s.vatPayer) {
      y += 28;
      doc.font('Regular').fontSize(9).text(NON_PAYER_NOTE, MARGIN, y, { width: COL_R - MARGIN });
    }

    doc.fontSize(7).fillColor('#888888').text('Doklad byl vygenerován systémem Tixly.', MARGIN, doc.page.height - MARGIN - 10, {
      width: COL_R - MARGIN,
      align: 'center',
    });
    doc.end();
  });
}
