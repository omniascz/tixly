import PDFDocument from 'pdfkit';
import type { ServiceDeps } from '../lib/service-container.js';

export interface StatementPeriod {
  from: string; // ISO date
  to: string; // ISO date
}

export interface StatementData {
  promoterName: string;
  promoterId: string;
  period: StatementPeriod;
  generatedAt: string;
  payouts: Array<{
    id: string;
    periodFrom: string;
    periodTo: string;
    grossRevenue: number; // INTEGER halíře
    platformFees: number; // INTEGER halíře
    refunds: number; // INTEGER halíře
    chargebacks: number; // INTEGER halíře
    rollingReserve: number; // INTEGER halíře
    netPayout: number; // INTEGER halíře
    status: string;
    paidAt: string | null;
  }>;
  totals: {
    grossRevenue: number;
    platformFees: number;
    refunds: number;
    chargebacks: number;
    rollingReserve: number;
    netPayout: number;
  };
}

// Helper: format integer halíře as Kč string (Czech format: "1 234,56 Kč")
function formatCzechKc(halirey: number): string {
  const kc = (halirey / 100).toFixed(2).replace('.', ',');
  return kc + ' Kč';
}

/**
 * Generates a PDF statement buffer from transaction data.
 */
export async function generateStatementPdf(data: StatementData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margins: 50,
    });

    const buffers: Buffer[] = [];

    doc.on('data', (chunk) => buffers.push(chunk));
    doc.on('end', () => {
      resolve(Buffer.concat(buffers));
    });
    doc.on('error', reject);

    // --- Header ---
    doc.font('Helvetica-Bold').fontSize(24).text('Tixly', { align: 'left' });
    doc.font('Helvetica').fontSize(14).text('Výpis transakcí', { align: 'left' });

    doc.moveDown(0.5);

    // --- Promoter Info Box ---
    const infoBoxY = doc.y;
    const infoBoxHeight = 60;
    const infoBoxX = 50;
    const infoBoxWidth = doc.page.width - 100;

    // Draw box border
    doc
      .rect(infoBoxX, infoBoxY, infoBoxWidth, infoBoxHeight)
      .stroke();

    doc.font('Helvetica-Bold').fontSize(10);
    doc.text(`Promotér: ${data.promoterName}`, infoBoxX + 10, infoBoxY + 8);
    doc.text(`ID: ${data.promoterId}`, infoBoxX + 10, infoBoxY + 24);
    doc.text(
      `Období: ${data.period.from} — ${data.period.to}`,
      infoBoxX + 10,
      infoBoxY + 40
    );

    doc.moveDown(4);

    // --- Generated At ---
    doc.font('Helvetica').fontSize(9);
    doc.text(`Vygenerováno: ${data.generatedAt}`, { align: 'right' });

    doc.moveDown(1);

    // --- Table Header ---
    const tableTop = doc.y;
    const colWidths = {
      period: 90,
      gross: 70,
      fees: 70,
      refunds: 70,
      chargebacks: 70,
      reserve: 70,
      net: 80,
      status: 80,
    };

    const headerY = tableTop;
    const headerHeight = 25;
    const headerX = 50;

    // Draw header background
    doc
      .rect(headerX, headerY, doc.page.width - 100, headerHeight)
      .fill('#EEEEEE');

    // Draw header text
    doc.font('Helvetica-Bold').fontSize(9).fillColor('black');

    const headers = [
      { text: 'Období', x: headerX, width: colWidths.period },
      { text: 'Hrubý příjem', x: headerX + colWidths.period, width: colWidths.gross },
      { text: 'Poplatky', x: headerX + colWidths.period + colWidths.gross, width: colWidths.fees },
      {
        text: 'Vráceniny',
        x: headerX + colWidths.period + colWidths.gross + colWidths.fees,
        width: colWidths.refunds,
      },
      {
        text: 'Chargebacky',
        x: headerX + colWidths.period + colWidths.gross + colWidths.fees + colWidths.refunds,
        width: colWidths.chargebacks,
      },
      {
        text: 'Rezerva',
        x:
          headerX +
          colWidths.period +
          colWidths.gross +
          colWidths.fees +
          colWidths.refunds +
          colWidths.chargebacks,
        width: colWidths.reserve,
      },
      {
        text: 'Výplata',
        x:
          headerX +
          colWidths.period +
          colWidths.gross +
          colWidths.fees +
          colWidths.refunds +
          colWidths.chargebacks +
          colWidths.reserve,
        width: colWidths.net,
      },
      {
        text: 'Stav',
        x:
          headerX +
          colWidths.period +
          colWidths.gross +
          colWidths.fees +
          colWidths.refunds +
          colWidths.chargebacks +
          colWidths.reserve +
          colWidths.net,
        width: colWidths.status,
      },
    ];

    headers.forEach((header) => {
      doc.text(header.text, header.x, headerY + 5, {
        width: header.width,
        align: 'center',
      });
    });

    // --- Table Rows ---
    let rowY = headerY + headerHeight;
    const rowHeight = 20;

    doc.font('Helvetica').fontSize(8);

    data.payouts.forEach((payout) => {
      const periodStr = `${payout.periodFrom.slice(5, 10)}—${payout.periodTo.slice(5, 10)}`;

      const cells = [
        { text: periodStr, x: headerX, width: colWidths.period },
        {
          text: formatCzechKc(payout.grossRevenue),
          x: headerX + colWidths.period,
          width: colWidths.gross,
        },
        {
          text: formatCzechKc(payout.platformFees),
          x: headerX + colWidths.period + colWidths.gross,
          width: colWidths.fees,
        },
        {
          text: formatCzechKc(payout.refunds),
          x: headerX + colWidths.period + colWidths.gross + colWidths.fees,
          width: colWidths.refunds,
        },
        {
          text: formatCzechKc(payout.chargebacks),
          x:
            headerX +
            colWidths.period +
            colWidths.gross +
            colWidths.fees +
            colWidths.refunds,
          width: colWidths.chargebacks,
        },
        {
          text: formatCzechKc(payout.rollingReserve),
          x:
            headerX +
            colWidths.period +
            colWidths.gross +
            colWidths.fees +
            colWidths.refunds +
            colWidths.chargebacks,
          width: colWidths.reserve,
        },
        {
          text: formatCzechKc(payout.netPayout),
          x:
            headerX +
            colWidths.period +
            colWidths.gross +
            colWidths.fees +
            colWidths.refunds +
            colWidths.chargebacks +
            colWidths.reserve,
          width: colWidths.net,
        },
        {
          text: payout.status === 'paid' ? 'Vyplaceno' : 'Čekající',
          x:
            headerX +
            colWidths.period +
            colWidths.gross +
            colWidths.fees +
            colWidths.refunds +
            colWidths.chargebacks +
            colWidths.reserve +
            colWidths.net,
          width: colWidths.status,
        },
      ];

      cells.forEach((cell) => {
        doc.text(cell.text, cell.x, rowY + 2, {
          width: cell.width,
          align: cell === cells[0] ? 'left' : 'right',
        });
      });

      rowY += rowHeight;
    });

    // --- Totals Row ---
    doc.font('Helvetica-Bold').fontSize(9);

    const totalCells = [
      { text: 'CELKEM', x: headerX, width: colWidths.period },
      {
        text: formatCzechKc(data.totals.grossRevenue),
        x: headerX + colWidths.period,
        width: colWidths.gross,
      },
      {
        text: formatCzechKc(data.totals.platformFees),
        x: headerX + colWidths.period + colWidths.gross,
        width: colWidths.fees,
      },
      {
        text: formatCzechKc(data.totals.refunds),
        x: headerX + colWidths.period + colWidths.gross + colWidths.fees,
        width: colWidths.refunds,
      },
      {
        text: formatCzechKc(data.totals.chargebacks),
        x:
          headerX +
          colWidths.period +
          colWidths.gross +
          colWidths.fees +
          colWidths.refunds,
        width: colWidths.chargebacks,
      },
      {
        text: formatCzechKc(data.totals.rollingReserve),
        x:
          headerX +
          colWidths.period +
          colWidths.gross +
          colWidths.fees +
          colWidths.refunds +
          colWidths.chargebacks,
        width: colWidths.reserve,
      },
      {
        text: formatCzechKc(data.totals.netPayout),
        x:
          headerX +
          colWidths.period +
          colWidths.gross +
          colWidths.fees +
          colWidths.refunds +
          colWidths.chargebacks +
          colWidths.reserve,
        width: colWidths.net,
      },
      {
        text: '',
        x:
          headerX +
          colWidths.period +
          colWidths.gross +
          colWidths.fees +
          colWidths.refunds +
          colWidths.chargebacks +
          colWidths.reserve +
          colWidths.net,
        width: colWidths.status,
      },
    ];

    totalCells.forEach((cell) => {
      doc.text(cell.text, cell.x, rowY + 2, {
        width: cell.width,
        align: cell === totalCells[0] ? 'left' : 'right',
      });
    });

    // --- Footer ---
    doc.moveDown(3);
    doc.font('Helvetica').fontSize(8).text('Tixly s.r.o.', { align: 'center' });
    doc.text(`Vygenerováno: ${data.generatedAt}`, { align: 'center' });

    // Page number
    const pages = doc.bufferedPageRange().count;
    for (let i = 0; i < pages; i++) {
      doc.switchToPage(i);
      doc.font('Helvetica').fontSize(8);
      doc.text(`Strana ${i + 1} z ${pages}`, 50, doc.page.height - 30, {
        align: 'center',
      });
    }

    doc.end();
  });
}

interface PayoutRow {
  id: string;
  promoter_id: string;
  period_from: string;
  period_to: string;
  gross_revenue: number;
  platform_fees: number;
  refunds: number;
  chargebacks: number;
  rolling_reserve: number;
  net_payout: number;
  status: string;
  paid_at: string | null;
  created_at: string;
}

interface PromoterRow {
  id: string;
  name: string;
}

/**
 * Fetches payout data for the period and generates PDF.
 */
export async function getPromoterStatementPdf(
  promoterId: string,
  period: StatementPeriod,
  deps: ServiceDeps
): Promise<Buffer> {
  // Fetch payouts for the period
  const payoutRows = await deps.db.query<PayoutRow>(
    `SELECT * FROM platform.payouts
     WHERE promoter_id = $1 AND created_at BETWEEN $2 AND $3
     ORDER BY created_at ASC`,
    [promoterId, `${period.from}T00:00:00Z`, `${period.to}T23:59:59Z`]
  );

  // Fetch promoter name
  const promoterRows = await deps.db.query<PromoterRow>(
    `SELECT id, name FROM platform.promoters WHERE id = $1`,
    [promoterId]
  );

  if (promoterRows.length === 0) {
    throw new Error('Promoter not found');
  }

  const promoterName = promoterRows[0].name;

  // Build StatementData
  const payouts = payoutRows.map((row) => ({
    id: row.id,
    periodFrom: row.period_from,
    periodTo: row.period_to,
    grossRevenue: row.gross_revenue,
    platformFees: row.platform_fees,
    refunds: row.refunds,
    chargebacks: row.chargebacks,
    rollingReserve: row.rolling_reserve,
    netPayout: row.net_payout,
    status: row.status,
    paidAt: row.paid_at,
  }));

  const totals = {
    grossRevenue: payouts.reduce((sum, p) => sum + p.grossRevenue, 0),
    platformFees: payouts.reduce((sum, p) => sum + p.platformFees, 0),
    refunds: payouts.reduce((sum, p) => sum + p.refunds, 0),
    chargebacks: payouts.reduce((sum, p) => sum + p.chargebacks, 0),
    rollingReserve: payouts.reduce((sum, p) => sum + p.rollingReserve, 0),
    netPayout: payouts.reduce((sum, p) => sum + p.netPayout, 0),
  };

  const now = new Date().toISOString();
  const data: StatementData = {
    promoterName,
    promoterId,
    period,
    generatedAt: now,
    payouts,
    totals,
  };

  return generateStatementPdf(data);
}
