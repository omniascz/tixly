/**
 * GET /api/admin/reports/pohoda?month=YYYY-MM
 *
 * Export tržeb v Pohoda XML formátu (dat_save/dataPack). Standard pro CZ
 * účetní software Stormware Pohoda.
 *
 * Vyrobí <dataPack><dataPackItem> pro každou paid objednávku jako záznam
 * <invoice> (přijatá faktura — vstupenka). Pohoda umí importovat přímo.
 *
 * Reference: https://www.stormware.cz/xml/
 */

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { requirePromoter } from '@/lib/admin-auth';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function halireToCzk(halire: number): string {
  return (halire / 100).toFixed(2);
}

interface OrderRow {
  id: string;
  paid_at: string;
  total_amount: number;
  currency: string;
  buyer_email: string;
  buyer_name: string | null;
  variable_symbol: string | null;
  event_title: string;
  ticket_count: string;
  promoter_ico: string | null;
  promoter_dic: string | null;
  promoter_name: string;
  promoter_vat_rate_pct: number;
  promoter_vat_payer: boolean;
}

export async function GET(req: NextRequest): Promise<Response> {
  const promoter = await requirePromoter(req);
  if (!promoter) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = req.nextUrl;
  const month = url.searchParams.get('month');
  let from: string;
  let to: string;
  if (month && /^\d{4}-\d{2}$/.test(month)) {
    from = `${month}-01`;
    const [y, m] = month.split('-').map(Number);
    const nextMonth = new Date(y!, m!, 1);
    to = nextMonth.toISOString().slice(0, 10);
  } else {
    const now = new Date();
    from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
    const nextM = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    to = nextM.toISOString().slice(0, 10);
  }

  const r = await db().query<OrderRow>(
    `SELECT
       o.id, o.paid_at, o.total_amount, o.currency,
       u.email AS buyer_email, u.name AS buyer_name,
       o.variable_symbol,
       e.title AS event_title,
       (SELECT COUNT(*)::text FROM tickets.tickets WHERE order_id = o.id) AS ticket_count,
       p.company_ico AS promoter_ico, p.company_dic AS promoter_dic,
       p.name AS promoter_name, p.vat_rate_pct AS promoter_vat_rate_pct,
       p.vat_payer AS promoter_vat_payer
     FROM orders.orders o
     JOIN identity.users u ON u.id = o.user_id
     LEFT JOIN catalog.events e ON e.id = o.event_id
     LEFT JOIN platform.promoters p ON p.id = e.promoter_id
     WHERE p.id = $1
       AND o.status = 'paid'
       AND o.paid_at >= $2 AND o.paid_at < $3
     ORDER BY o.paid_at ASC`,
    [promoter.promoterId, from, to],
  );

  const orders = r.rows;
  const promoterIco = orders[0]?.promoter_ico ?? '';
  const promoterDic = orders[0]?.promoter_dic ?? '';
  const vatRate = orders[0]?.promoter_vat_rate_pct ?? 10;
  const vatPayer = orders[0]?.promoter_vat_payer ?? true;
  const dataPackId = `tixly-${month ?? from}-${promoter.promoterId.slice(0, 8)}`;

  function invoiceItem(o: OrderRow): string {
    const total = o.total_amount;
    const net = vatPayer ? Math.round(total / (1 + vatRate / 100)) : total;
    const vat = total - net;
    const vsAttr = o.variable_symbol ? `<inv:symVar>${xmlEscape(o.variable_symbol)}</inv:symVar>` : '';
    const date = o.paid_at.slice(0, 10);
    return `
    <dat:dataPackItem version="2.0" id="${xmlEscape(o.id.slice(0, 8))}">
      <inv:invoice version="2.0">
        <inv:invoiceHeader>
          <inv:invoiceType>receivedInvoice</inv:invoiceType>
          <inv:number><typ:numberRequested>${xmlEscape(o.id.slice(0, 10))}</typ:numberRequested></inv:number>
          ${vsAttr}
          <inv:date>${date}</inv:date>
          <inv:dateTax>${date}</inv:dateTax>
          <inv:dateDuePayment>${date}</inv:dateDuePayment>
          <inv:text>${xmlEscape(`Vstupenka: ${o.event_title} (${o.ticket_count}×)`)}</inv:text>
          <inv:partnerIdentity>
            <typ:address>
              <typ:company>${xmlEscape(o.buyer_name ?? o.buyer_email)}</typ:company>
              <typ:email>${xmlEscape(o.buyer_email)}</typ:email>
            </typ:address>
          </inv:partnerIdentity>
          <inv:classificationVAT><typ:classificationVATType>inland</typ:classificationVATType></inv:classificationVAT>
        </inv:invoiceHeader>
        <inv:invoiceSummary>
          <inv:roundingDocument>none</inv:roundingDocument>
          <inv:homeCurrency>
            <typ:priceNone>0</typ:priceNone>
            ${vatPayer ? `<typ:priceLow>${halireToCzk(net)}</typ:priceLow><typ:priceLowVAT>${halireToCzk(vat)}</typ:priceLowVAT><typ:priceLowSum>${halireToCzk(total)}</typ:priceLowSum>` : `<typ:priceNone>${halireToCzk(total)}</typ:priceNone>`}
          </inv:homeCurrency>
        </inv:invoiceSummary>
      </inv:invoice>
    </dat:dataPackItem>`;
  }

  const xml = `<?xml version="1.0" encoding="utf-8"?>
<dat:dataPack
  version="2.0"
  id="${dataPackId}"
  ico="${xmlEscape(promoterIco)}"
  application="Tixly"
  xmlns:dat="http://www.stormware.cz/schema/version_2/data.xsd"
  xmlns:inv="http://www.stormware.cz/schema/version_2/invoice.xsd"
  xmlns:typ="http://www.stormware.cz/schema/version_2/type.xsd">
  <dat:dataPackItem version="2.0" id="info">
    <inv:invoice version="2.0">
      <inv:invoiceHeader>
        <inv:invoiceType>issuedInvoice</inv:invoiceType>
        <inv:text>Souhrnný export tržeb ${month ?? from} pro ${xmlEscape(orders[0]?.promoter_name ?? 'promotér')} (IČO ${xmlEscape(promoterIco)}, DIČ ${xmlEscape(promoterDic)})</inv:text>
      </inv:invoiceHeader>
    </inv:invoice>
  </dat:dataPackItem>
  ${orders.map(invoiceItem).join('\n')}
</dat:dataPack>`;

  return new Response(xml, {
    status: 200,
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Content-Disposition': `attachment; filename="tixly-pohoda-${month ?? 'current'}.xml"`,
    },
  });
}
