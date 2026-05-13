// scripts/test-pdf-render.mjs
// Vyrenderuje sample PDF s Divadlo Verze brandingem pro vizuální kontrolu.
// Output: state/test-ticket-celetna.pdf

import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const requireFromApp = createRequire(join(__dirname, '..', 'nextjs-boilerplate', 'noop.js'));

// Import přes tsx, jinak ts-node — pdf-renderer.ts není pre-compiled. Workaround:
// volat přímo přes podaná data, ne přes import. Místo toho zkompilujeme TS přes esbuild zde
// — to je overkill. Použiju pdfkit přímo, ale s identickou strukturou.

const PDFDocument = requireFromApp('pdfkit');
const QRCode = requireFromApp('qrcode');

const brandColor = '#B71C1C';
const promoterName = 'Divadlo Verze';
const vatRatePct = 10;
const productionMode = false;

const header = {
  eventTitle: 'Eddie & Vanessa — premiéra',
  eventDateStart: '2026-06-02T19:30:00.000Z',
  venueName: 'Divadlo v Celetné — Hlavní sál',
  buyerName: 'Jan Novák',
  buyerEmail: 'jan@example.cz',
  orderId: '00000000-0000-4000-a000-000000000abc',
};

const tickets = [
  {
    ticketId: 'TIX-001',
    ticketTypeName: 'Plné vstupné',
    totpSecretBase32: 'JBSWY3DPEHPK3PXP',
    holderLabel: header.buyerEmail,
    issuer: header.eventTitle,
    unitPriceHalire: 39000,
    seatLabel: 'HLEDIŠTĚ · řada 5 · sedadlo 6',
  },
  {
    ticketId: 'TIX-002',
    ticketTypeName: 'Plné vstupné',
    totpSecretBase32: 'KBSWZ3DPEHPK3PXQ',
    holderLabel: header.buyerEmail,
    issuer: header.eventTitle,
    unitPriceHalire: 39000,
    seatLabel: 'HLEDIŠTĚ · řada 5 · sedadlo 7',
  },
];

function formatCzk(halire) {
  return `${(halire / 100).toLocaleString('cs-CZ', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} Kč`;
}

function buildOtpauthUri({ label, issuer, secretBase32 }) {
  const enc = (s) => encodeURIComponent(s);
  const lab = `${enc(issuer)}:${enc(label)}`;
  const params = new URLSearchParams({
    secret: secretBase32, issuer, algorithm: 'SHA1', digits: '6', period: '30',
  });
  return `otpauth://totp/${lab}?${params.toString()}`;
}

async function run() {
  const doc = new PDFDocument({ size: 'A4', margin: 48 });
  doc.registerFont('main', join(__dirname, '..', 'nextjs-boilerplate', 'src', 'lib', 'tickets', 'fonts', 'NotoSans-Regular.ttf'));
  doc.registerFont('bold', join(__dirname, '..', 'nextjs-boilerplate', 'src', 'lib', 'tickets', 'fonts', 'NotoSans-Bold.ttf'));
  doc.font('main');
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));

  for (let i = 0; i < tickets.length; i++) {
    if (i > 0) doc.addPage();
    const t = tickets[i];

    doc.rect(0, 0, doc.page.width, 8).fill(brandColor);
    doc.fontSize(20).fillColor(brandColor).text(promoterName, 48, 28);
    if (!productionMode) {
      doc.fontSize(9).fillColor('#999').text('Demo vstupenka · neslouží k reálnému vstupu', 48, 52);
    }
    doc.moveDown(2);

    doc.fontSize(18).fillColor('#111').text(header.eventTitle);
    doc.moveDown(0.3);

    const date = new Date(header.eventDateStart).toLocaleString('cs-CZ', { dateStyle: 'long', timeStyle: 'short' });
    doc.fontSize(11).fillColor('#444').text(`Datum: ${date}`);
    doc.text(`Místo: ${header.venueName}`);
    doc.moveDown(0.8);

    doc.fontSize(10).fillColor('#666').text('Držitel');
    doc.fontSize(13).fillColor('#111').text(header.buyerName);
    doc.fontSize(10).fillColor('#666').text(header.buyerEmail);
    doc.moveDown(0.5);

    doc.fontSize(10).fillColor('#666').text('Typ vstupenky');
    doc.fontSize(14).fillColor('#111').text(t.ticketTypeName);
    if (t.seatLabel) doc.fontSize(11).fillColor('#444').text(`Sedadlo: ${t.seatLabel}`);
    doc.moveDown(0.5);

    const otpauthUri = buildOtpauthUri({ label: t.holderLabel, issuer: t.issuer, secretBase32: t.totpSecretBase32 });
    const qrPng = await QRCode.toBuffer(otpauthUri, { errorCorrectionLevel: 'M', margin: 1, width: 220 });
    const qrY = doc.y + 10;
    doc.image(qrPng, doc.page.width / 2 - 110, qrY, { width: 220, height: 220 });
    doc.y = qrY + 230;

    doc.fontSize(9).fillColor('#666').text(`Lístek: ${t.ticketId}`, { align: 'center' });
    doc.fontSize(9).fillColor('#666').text(`Objednávka: ${header.orderId}`, { align: 'center' });
  }

  // Tax summary
  doc.addPage();
  doc.rect(0, 0, doc.page.width, 8).fill(brandColor);
  doc.fontSize(20).fillColor(brandColor).text(promoterName, 48, 28);
  doc.fontSize(9).fillColor('#666').text('Daňový doklad (demo)', 48, 52);
  doc.moveDown(2);

  doc.fontSize(16).fillColor('#111').text('Daňový rozpis');
  doc.moveDown(0.5);
  doc.fontSize(10).fillColor('#666').text(`Akce: ${header.eventTitle}`);
  doc.text(`Kupec: ${header.buyerName} (${header.buyerEmail})`);
  doc.text(`Objednávka: ${header.orderId}`);
  doc.text(`Vystaveno: ${new Date().toLocaleDateString('cs-CZ')}`);
  doc.moveDown();

  const colX = { name: 48, qty: 320, unit: 370, total: 470 };
  const y0 = doc.y;
  doc.fontSize(10).fillColor('#666');
  doc.text('Položka', colX.name, y0);
  doc.text('Ks', colX.qty, y0);
  doc.text('Cena/ks (s DPH)', colX.unit, y0);
  doc.text('Celkem', colX.total, y0);
  doc.moveTo(48, y0 + 14).lineTo(550, y0 + 14).stroke('#ddd');
  doc.y = y0 + 18;

  const grouped = new Map();
  for (const t of tickets) {
    const prev = grouped.get(t.ticketTypeName) ?? { qty: 0, unit: t.unitPriceHalire };
    prev.qty += 1;
    grouped.set(t.ticketTypeName, prev);
  }

  let totalGross = 0;
  for (const [name, { qty, unit }] of grouped) {
    const ly = doc.y;
    doc.fontSize(11).fillColor('#111').text(name, colX.name, ly);
    doc.text(String(qty), colX.qty, ly);
    doc.text(formatCzk(unit), colX.unit, ly);
    doc.text(formatCzk(unit * qty), colX.total, ly);
    totalGross += unit * qty;
    doc.moveDown(0.5);
  }

  doc.moveDown(0.3);
  doc.moveTo(320, doc.y).lineTo(550, doc.y).stroke('#ddd');
  doc.moveDown(0.4);

  const netHalire = Math.round(totalGross / (1 + vatRatePct / 100));
  const vatHalire = totalGross - netHalire;

  doc.fontSize(11).fillColor('#444');
  doc.text('Základ daně:', 320, doc.y);
  doc.text(formatCzk(netHalire), colX.total, doc.y - 13);
  doc.moveDown(0.4);
  doc.text(`DPH ${vatRatePct} %:`, 320, doc.y);
  doc.text(formatCzk(vatHalire), colX.total, doc.y - 13);
  doc.moveDown(0.4);
  doc.font('bold').fillColor('#111');
  doc.text('Celkem k úhradě:', 320, doc.y);
  doc.text(formatCzk(totalGross), colX.total, doc.y - 13);
  doc.font('main');

  doc.moveDown(1.5);
  doc.fontSize(8).fillColor('#666').text(
    'Snížená sazba DPH 10 % se vztahuje na vstupné na divadelní, hudební a obdobné kulturní akce (§ 47 zákona o DPH).',
    48, undefined, { width: 500 },
  );

  doc.end();
  const out = await new Promise((res, rej) => {
    doc.on('end', () => res(Buffer.concat(chunks)));
    doc.on('error', rej);
  });

  const outPath = join(__dirname, '..', 'state', 'test-ticket-celetna.pdf');
  writeFileSync(outPath, out);
  console.log(`✓ PDF napsán: ${outPath} (${out.length} B)`);
}

run().catch((e) => { console.error(e); process.exit(1); });
