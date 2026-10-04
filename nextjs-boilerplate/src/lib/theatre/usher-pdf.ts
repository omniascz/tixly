/**
 * Tisk seznamu pro uvaděče (kolo 8 / krok 8): A4 na šířku, tabulka sál | řada | místo | kategorie | jméno | ověřit průkaz.
 * pdfkit + Noto Sans (diakritika), stejně jako PDF vstupenek.
 */
import { join } from 'node:path';
import PDFDocument from 'pdfkit';
import type { UsherRow } from '@/lib/theatre/reports';

const FONT_DIR = join(process.cwd(), 'src', 'lib', 'tickets', 'fonts');

export function buildUsherPdf(head: { title: string; dateStart: string; hall: string | null }, rows: UsherRow[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 36 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.registerFont('R', join(FONT_DIR, 'NotoSans-Regular.ttf'));
    doc.registerFont('B', join(FONT_DIR, 'NotoSans-Bold.ttf'));

    const date = new Date(head.dateStart).toLocaleString('cs-CZ', { timeZone: 'Europe/Prague', dateStyle: 'long', timeStyle: 'short' });
    const cols: Array<{ label: string; w: number; get: (r: UsherRow) => string }> = [
      { label: 'Sekce', w: 110, get: (r) => r.sector ?? '' },
      { label: 'Řada', w: 50, get: (r) => r.row ?? '' },
      { label: 'Místo', w: 50, get: (r) => r.seat ?? '' },
      { label: 'Kategorie', w: 130, get: (r) => r.category ?? 'Plné' },
      { label: 'Jméno', w: 230, get: (r) => r.name ?? '' },
      { label: 'Ověřit průkaz', w: 120, get: (r) => r.verifyId ?? '' },
      { label: 'Stav', w: 70, get: (r) => (r.ticketStatus === 'used' ? 'vstoupil' : '') },
    ];
    const header = (): void => {
      doc.font('B').fontSize(14).text(`${head.title} — seznam pro uvaděče`, { continued: false });
      doc.font('R').fontSize(10).text(`${date}${head.hall ? ` · ${head.hall}` : ''} · ${rows.length} vstupenek`);
      doc.moveDown(0.5);
      let x = doc.page.margins.left;
      const y = doc.y;
      doc.font('B').fontSize(9);
      for (const c of cols) { doc.text(c.label, x, y, { width: c.w - 6 }); x += c.w; }
      doc.moveTo(doc.page.margins.left, y + 14).lineTo(doc.page.width - doc.page.margins.right, y + 14).stroke();
      doc.y = y + 18;
    };
    header();
    doc.font('R').fontSize(9);
    for (const r of rows) {
      if (doc.y > doc.page.height - doc.page.margins.bottom - 16) { doc.addPage(); header(); doc.font('R').fontSize(9); }
      let x = doc.page.margins.left;
      const y = doc.y;
      for (const c of cols) {
        const v = c.get(r);
        doc.font(c.label === 'Ověřit průkaz' && v ? 'B' : 'R').text(v, x, y, { width: c.w - 6, lineBreak: false, ellipsis: true });
        x += c.w;
      }
      doc.y = y + 14;
    }
    doc.end();
  });
}
