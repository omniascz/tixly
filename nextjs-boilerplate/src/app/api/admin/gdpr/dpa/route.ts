import { NextRequest, NextResponse } from 'next/server';
import { join } from 'node:path';
import PDFDocument from 'pdfkit';
import { db } from '@/lib/db/rls-pool';
import { runAsPromoter } from '@/lib/admin-auth';

const FONT_DIR = join(process.cwd(), 'src', 'lib', 'tickets', 'fonts');
const FONT_REGULAR = join(FONT_DIR, 'NotoSans-Regular.ttf');
const FONT_BOLD = join(FONT_DIR, 'NotoSans-Bold.ttf');

const MARGIN = 50;
const PAGE_W = 595.28;

interface PromoterInfo {
  name: string;
  email: string;
  company_ico: string | null;
  company_address: string | null;
}

function buildDpaPdf(p: PromoterInfo, date: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: MARGIN, info: { Title: 'Smlouva o zpracování osobních údajů' } });
    doc.registerFont('Regular', FONT_REGULAR);
    doc.registerFont('Bold', FONT_BOLD);

    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const W = PAGE_W - 2 * MARGIN;

    doc.font('Bold').fontSize(16).text('SMLOUVA O ZPRACOVÁNÍ OSOBNÍCH ÚDAJŮ', MARGIN, MARGIN, { width: W, align: 'center' });
    doc.font('Regular').fontSize(9).text('(dle čl. 28 GDPR)', MARGIN, MARGIN + 22, { width: W, align: 'center' });

    doc.moveDown(2);
    doc.font('Bold').fontSize(10).text('1. SMLUVNÍ STRANY');
    doc.moveDown(0.5);
    doc.font('Bold').fontSize(9).text('Správce osobních údajů:');
    doc.font('Regular').fontSize(9).text(p.name);
    if (p.company_address) doc.text(p.company_address);
    if (p.company_ico) doc.text(`IČO: ${p.company_ico}`);
    doc.text(`E-mail: ${p.email}`);
    doc.moveDown(0.5);
    doc.font('Bold').fontSize(9).text('Zpracovatel osobních údajů:');
    doc.font('Regular').fontSize(9)
      .text('Tixly s.r.o.')
      .text('Příkop 843/4, 602 00 Brno')
      .text('IČO: 21437892')
      .text('E-mail: gdpr@tixly.cz');

    doc.moveDown(1);
    doc.font('Bold').fontSize(10).text('2. PŘEDMĚT ZPRACOVÁNÍ');
    doc.moveDown(0.5);
    doc.font('Regular').fontSize(9).text(
      'Zpracovatel zpracovává osobní údaje zákazníků Správce v rámci poskytování ' +
      'ticketingové platformy Tixly (prodej vstupenek, správa objednávek, komunikace se zákazníky).',
      { width: W },
    );

    doc.moveDown(1);
    doc.font('Bold').fontSize(10).text('3. ÚČEL A PRÁVNÍ ZÁKLAD ZPRACOVÁNÍ');
    doc.moveDown(0.5);
    doc.font('Regular').fontSize(9).text(
      'Osobní údaje jsou zpracovávány za účelem: (a) prodeje a správy vstupenek, ' +
      '(b) komunikace s kupujícími, (c) splnění zákonných povinností. ' +
      'Právní základ: plnění smlouvy (čl. 6 odst. 1 písm. b) GDPR) a oprávněný zájem.',
      { width: W },
    );

    doc.moveDown(1);
    doc.font('Bold').fontSize(10).text('4. KATEGORIE OSOBNÍCH ÚDAJŮ');
    doc.moveDown(0.5);
    doc.font('Regular').fontSize(9).text(
      'Jméno a příjmení, e-mailová adresa, telefonní číslo, platební informace ' +
      '(tokenizované), IP adresa, identifikátory zařízení.',
      { width: W },
    );

    doc.moveDown(1);
    doc.font('Bold').fontSize(10).text('5. DOBA UCHOVÁVÁNÍ');
    doc.moveDown(0.5);
    doc.font('Regular').fontSize(9).text(
      'Osobní údaje jsou uchovávány po dobu trvání smluvního vztahu a dále: ' +
      '10 let pro účetní doklady (zákon č. 563/1991 Sb.), ' +
      '3 roky pro marketingové souhlasy od udělení, ' +
      '90 dní pro logy přístupu.',
      { width: W },
    );

    doc.moveDown(1);
    doc.font('Bold').fontSize(10).text('6. SUBZPRACOVATELÉ');
    doc.moveDown(0.5);
    doc.font('Regular').fontSize(9);
    const subProcessors = [
      ['Neon Inc.', 'USA', 'Databázové služby (PostgreSQL)', 'SCCs + DPA'],
      ['Vercel Inc.', 'USA', 'Hosting a CDN', 'SCCs + DPA'],
      ['Resend Inc.', 'USA', 'Transakční e-maily', 'SCCs + DPA'],
      ['GoPay s.r.o.', 'CZ', 'Platební brána', 'EU subjekt'],
    ];
    for (const [spName, country, purpose, basis] of subProcessors) {
      doc.text(`• ${spName} (${country}) — ${purpose} — ${basis}`);
    }

    doc.moveDown(1);
    doc.font('Bold').fontSize(10).text('7. PRÁVA SUBJEKTŮ ÚDAJŮ');
    doc.moveDown(0.5);
    doc.font('Regular').fontSize(9).text(
      'Správce zajistí výkon práv subjektů údajů: právo na přístup, opravu, výmaz, ' +
      'přenositelnost, omezení zpracování a námitku. Žádosti se vyřizují do 30 dnů.',
      { width: W },
    );

    doc.moveDown(1);
    doc.font('Bold').fontSize(10).text('8. BEZPEČNOSTNÍ OPATŘENÍ');
    doc.moveDown(0.5);
    doc.font('Regular').fontSize(9).text(
      'Zpracovatel implementuje: šifrování dat v klidu (AES-256) a při přenosu (TLS 1.2+), ' +
      'řízení přístupu (RBAC), pravidelné zálohy, penetrační testování.',
      { width: W },
    );

    doc.moveDown(1);
    doc.font('Bold').fontSize(10).text('9. HLÁŠENÍ INCIDENTŮ');
    doc.moveDown(0.5);
    doc.font('Regular').fontSize(9).text(
      'V případě porušení zabezpečení osobních údajů zpracovatel neprodleně, nejpozději ' +
      'do 72 hodin od zjištění, informuje Správce na gdpr@tixly.cz.',
      { width: W },
    );

    doc.moveDown(1);
    doc.font('Bold').fontSize(10).text('10. UKONČENÍ SMLOUVY');
    doc.moveDown(0.5);
    doc.font('Regular').fontSize(9).text(
      'Po ukončení smlouvního vztahu Zpracovatel na žádost Správce vymaže nebo vrátí ' +
      'osobní údaje do 30 dnů, pokud právní předpisy nestanoví jinak.',
      { width: W },
    );

    doc.moveDown(2);
    doc.font('Regular').fontSize(9)
      .text(`Datum: ${date}`, MARGIN, undefined, { width: W / 2 });

    doc.moveDown(2);
    doc.font('Bold').fontSize(9).text('Za Správce:', MARGIN, undefined, { width: W / 2, continued: true });
    doc.text('Za Zpracovatel (Tixly s.r.o.):', { align: 'right' });
    doc.font('Regular').fontSize(9);
    doc.moveDown(2);
    doc.text('____________________________', MARGIN, undefined, { width: W / 2, continued: true });
    doc.text('____________________________', { align: 'right' });

    doc.fontSize(7).fillColor('#888888')
      .text(
        'Dokument vygenerován automaticky systémem Tixly.',
        MARGIN,
        doc.page.height - MARGIN - 10,
        { width: W, align: 'center' },
      );

    doc.end();
  });
}

export async function GET(req: NextRequest): Promise<Response> {
  return runAsPromoter(req, async (ctx) => {
    const r = await db().query<PromoterInfo>(
      `SELECT name, email, company_ico, company_address FROM platform.promoters WHERE id = $1`,
      [ctx.promoterId],
    );
    if (r.rows.length === 0) {
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    }
    const promoter = r.rows[0];
    const date = new Date().toLocaleDateString('cs-CZ');
    const pdfBuffer = await buildDpaPdf(promoter, date);
    const safeName = promoter.name.replace(/[^a-zA-Z0-9]/g, '-');

    return new Response(new Uint8Array(pdfBuffer), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="DPA-Tixly-${safeName}.pdf"`,
        'Content-Length': String(pdfBuffer.length),
      },
    });
  });
}
