/**
 * Generátor dokumentů pro QES podpis.
 * Používá pdfkit (stejně jako invoice-pdf.ts a tickets/pdf-renderer.ts).
 */

import { createHash } from 'crypto';

export interface PromoterAgreementData {
  promoterName: string;
  companyName?: string;
  ico?: string;
  email: string;
  address?: string;
  locale?: string;
  generatedAt?: string;  // ISO 8601 — pokud není, použije se now()
}

export interface GeneratedDocument {
  pdfBuffer: Buffer;
  pdfBase64: string;
  sha256hex: string;
  title: string;
}

/** Vygeneruje PDF smlouvy promotéra a vrátí Buffer + SHA-256 hash */
export async function generatePromoterAgreementPdf(
  data: PromoterAgreementData,
): Promise<GeneratedDocument> {
  const PDFDocument = (await import('pdfkit')).default;

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 60 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('error', reject);
    doc.on('end', () => {
      const pdfBuffer = Buffer.concat(chunks);
      const sha256hex = createHash('sha256').update(pdfBuffer).digest('hex');
      resolve({
        pdfBuffer,
        pdfBase64: pdfBuffer.toString('base64'),
        sha256hex,
        title: `Smlouva o poskytování služeb – ${data.companyName ?? data.promoterName}`,
      });
    });

    const generatedAt = data.generatedAt ?? new Date().toISOString().slice(0, 10);

    // === Header ===
    doc
      .fontSize(20).font('Helvetica-Bold')
      .text('SMLOUVA O POSKYTOVÁNÍ SLUŽEB', { align: 'center' })
      .moveDown(0.3)
      .fontSize(10).font('Helvetica')
      .text('Platforma Tixly · Tixly s.r.o., IČO 000 00 000, Praha, ČR', { align: 'center' })
      .moveDown(1.5);

    // === Smluvní strany ===
    doc.fontSize(12).font('Helvetica-Bold').text('I. Smluvní strany').moveDown(0.5);
    doc.fontSize(10).font('Helvetica');
    doc.text(`Poskytovatel: Tixly s.r.o., se sídlem V Parku 2308/10, 148 00 Praha 4, IČO 000 00 000`);
    doc.text(`Zapsaná v obchodním rejstříku vedeném Městským soudem v Praze, oddíl C, vložka 000000`);
    doc.moveDown(0.5);
    doc.text(`Promotér: ${data.companyName ?? data.promoterName}`);
    if (data.ico) doc.text(`IČO: ${data.ico}`);
    doc.text(`E-mail: ${data.email}`);
    if (data.address) doc.text(`Adresa: ${data.address}`);
    doc.moveDown(1);

    // === Předmět smlouvy ===
    doc.fontSize(12).font('Helvetica-Bold').text('II. Předmět smlouvy').moveDown(0.5);
    doc.fontSize(10).font('Helvetica');
    doc.text(
      'Poskytovatel se zavazuje zpřístupnit Promotérovi platformu Tixly pro správu a prodej vstupenek ' +
      'na kulturní, sportovní a jiné akce (dále jen „Služba"). Promotér se zavazuje platit za využívání ' +
      'Služby provizi stanovenou v Ceníku.',
      { align: 'justify' },
    );
    doc.moveDown(1);

    // === Provize a platby ===
    doc.fontSize(12).font('Helvetica-Bold').text('III. Provize a platby').moveDown(0.5);
    doc.fontSize(10).font('Helvetica');
    doc.text(
      'Provize Poskytovatele činí 2,5 % (+ DPH) z prodejní ceny každé vstupenky. ' +
      'Provize je strháváná automaticky při každé transakci. ' +
      'Výplaty jsou prováděny 7 dní po konání akce na bankovní účet Promotéra.',
      { align: 'justify' },
    );
    doc.moveDown(1);

    // === Odpovědnost ===
    doc.fontSize(12).font('Helvetica-Bold').text('IV. Odpovědnost').moveDown(0.5);
    doc.fontSize(10).font('Helvetica');
    doc.text(
      'Promotér je výhradně odpovědný za obsah akcí, jejich pořádání a dodržování všech platných ' +
      'právních předpisů. Poskytovatel nenese odpovědnost za zrušení, odložení nebo změnu akce. ' +
      'Odpovědnost Poskytovatele za škodu je omezena na výši provizí uhrazených za posledních 12 měsíců.',
      { align: 'justify' },
    );
    doc.moveDown(1);

    // === GDPR a ochrana dat ===
    doc.fontSize(12).font('Helvetica-Bold').text('V. Zpracování osobních údajů').moveDown(0.5);
    doc.fontSize(10).font('Helvetica');
    doc.text(
      'Smluvní strany se dohodly na uzavření Smlouvy o zpracování osobních údajů dle čl. 28 GDPR ' +
      '(nařízení EU 2016/679). Poskytovatel zpracovává osobní údaje zákazníků jako zpracovatel ' +
      'na základě pokynů Promotéra. Podrobné podmínky jsou dostupné na tixly.cz/dpa.',
      { align: 'justify' },
    );
    doc.moveDown(1);

    // === Trvání a ukončení ===
    doc.fontSize(12).font('Helvetica-Bold').text('VI. Trvání a ukončení').moveDown(0.5);
    doc.fontSize(10).font('Helvetica');
    doc.text(
      'Smlouva se uzavírá na dobu neurčitou. Každá smluvní strana může smlouvu vypovědět ' +
      's výpovědní lhůtou 30 dnů. Výpověď musí být doručena písemně na kontaktní email druhé strany.',
      { align: 'justify' },
    );
    doc.moveDown(1.5);

    // === Podpisy ===
    doc.fontSize(12).font('Helvetica-Bold').text('VII. Podpisy').moveDown(0.5);
    doc.fontSize(10).font('Helvetica');
    doc.text(`Datum: ${generatedAt}`);
    doc.moveDown(1);

    const signY = doc.y;
    doc.fontSize(10).font('Helvetica');
    // Levý sloupec
    doc.text('Poskytovatel:', 60, signY);
    doc.text('Tixly s.r.o.', 60, signY + 15);
    doc.moveTo(60, signY + 60).lineTo(240, signY + 60).stroke();
    doc.text('(podpis oprávněné osoby)', 60, signY + 65);

    // Pravý sloupec
    doc.text('Promotér:', 310, signY);
    doc.text(data.companyName ?? data.promoterName, 310, signY + 15);
    doc.moveTo(310, signY + 60).lineTo(490, signY + 60).stroke();
    doc.text('(elektronický podpis / QES)', 310, signY + 65);

    doc.moveDown(4);

    // === Fingerprint ===
    doc.fontSize(8).font('Helvetica').fillColor('#888888');
    doc.text(
      `Dokument vygenerován: ${generatedAt} · SHA-256 otisku bude doplněn po podpisu · ` +
      `eIDAS QES · nařízení EU 910/2014 · tixly.cz`,
      { align: 'center' },
    );

    doc.end();
  });
}
