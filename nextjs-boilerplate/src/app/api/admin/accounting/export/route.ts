import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsActivePromoterNonStaff } from '@/lib/admin-auth';

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function fmtAmt(minor: number): string {
  return (minor / 100).toFixed(2);
}

function escapeSemiCsv(s: string | null | undefined): string {
  if (!s) return '';
  if (s.includes('"') || s.includes(';') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function escapeCsv(s: string | null | undefined): string {
  if (!s) return '';
  if (s.includes('"') || s.includes(',') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

interface InvoiceRow {
  invoice_number: string;
  customer_name: string;
  customer_address: string | null;
  customer_ico: string | null;
  customer_dic: string | null;
  customer_email: string | null;
  subtotal_minor: number;
  vat_amount_minor: number;
  total_minor: number;
  currency: string;
  issue_date: string;
  due_date: string;
}

export async function GET(req: NextRequest): Promise<Response> {
  return runAsActivePromoterNonStaff(req, async (promoter) => {
    const sp = new URL(req.url).searchParams;
    const format = sp.get('format') ?? 'csv';
    const now = new Date();
    const defaultFrom = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    const from = sp.get('from') ?? defaultFrom;
    const to = sp.get('to') ?? now.toISOString().slice(0, 10);

    if (!['pohoda', 'money_s3', 'csv'].includes(format)) {
      return NextResponse.json({ error: 'INVALID_FORMAT' }, { status: 400 });
    }

    const r = await db().query<InvoiceRow>(
      `SELECT i.invoice_number, i.customer_name, i.customer_address, i.customer_ico,
              i.customer_dic, i.customer_email, i.subtotal_minor, i.vat_amount_minor,
              i.total_minor, i.currency, i.issue_date::text, i.due_date::text
       FROM orders.invoices i
       WHERE i.promoter_id = $1
         AND i.issue_date BETWEEN $2 AND $3
       ORDER BY i.issue_date ASC`,
      [promoter.promoterId, from, to],
    );

    const rows = r.rows;

    if (format === 'pohoda') {
      const pRes = await db().query<{ company_ico: string | null }>(
        `SELECT company_ico FROM platform.promoters WHERE id = $1`,
        [promoter.promoterId],
      );
      const promoterIco = pRes.rows[0]?.company_ico ?? '';

      const items = rows
        .map(
          (inv) => `  <dat:dataPackItem id="${escapeXml(inv.invoice_number)}" version="2.0">
    <inv:invoice version="2.0">
      <inv:invoiceHeader>
        <inv:invoiceType>issuedInvoice</inv:invoiceType>
        <inv:number><inv:numberRequested>${escapeXml(inv.invoice_number)}</inv:numberRequested></inv:number>
        <inv:date>${inv.issue_date}</inv:date>
        <inv:dateDue>${inv.due_date}</inv:dateDue>
        <inv:partnerIdentity>
          <inv:address>
            <inv:company>${escapeXml(inv.customer_name)}</inv:company>
            <inv:ico>${escapeXml(inv.customer_ico ?? '')}</inv:ico>
            <inv:dic>${escapeXml(inv.customer_dic ?? '')}</inv:dic>
            <inv:email>${escapeXml(inv.customer_email ?? '')}</inv:email>
          </inv:address>
        </inv:partnerIdentity>
        <inv:paymentType><inv:paymentType>draft</inv:paymentType></inv:paymentType>
        <inv:account><inv:accountNo></inv:accountNo><inv:bankCode></inv:bankCode></inv:account>
      </inv:invoiceHeader>
      <inv:invoiceSummary>
        <inv:roundingDocument>math2</inv:roundingDocument>
        <inv:homeCurrency>
          <inv:priceNone>0</inv:priceNone>
          <inv:priceLow>0</inv:priceLow>
          <inv:priceLowVAT>0</inv:priceLowVAT>
          <inv:priceHigh>${fmtAmt(inv.subtotal_minor)}</inv:priceHigh>
          <inv:priceHighVAT>${fmtAmt(inv.vat_amount_minor)}</inv:priceHighVAT>
        </inv:homeCurrency>
      </inv:invoiceSummary>
    </inv:invoice>
  </dat:dataPackItem>`,
        )
        .join('\n');

      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<dat:dataPack xmlns:dat="http://www.stormware.cz/schema/version_2/data.xsd"
              xmlns:inv="http://www.stormware.cz/schema/version_2/invoice.xsd"
              id="Tixly" ico="${escapeXml(promoterIco)}" application="Tixly" version="2.0"
              note="Export z Tixly">
${items}
</dat:dataPack>`;

      return new Response(xml, {
        headers: {
          'Content-Type': 'application/xml; charset=utf-8',
          'Content-Disposition': `attachment; filename="pohoda-export-${from.slice(0, 7)}.xml"`,
          'Cache-Control': 'no-store',
        },
      });
    }

    if (format === 'money_s3') {
      const header =
        'Číslo faktury;Datum vystavení;Datum splatnosti;Odběratel;IČO;DIČ;Email;Základ DPH;DPH;Celkem;Měna';
      const dataRows = rows.map((inv) =>
        [
          escapeSemiCsv(inv.invoice_number),
          inv.issue_date,
          inv.due_date,
          escapeSemiCsv(inv.customer_name),
          escapeSemiCsv(inv.customer_ico),
          escapeSemiCsv(inv.customer_dic),
          escapeSemiCsv(inv.customer_email),
          fmtAmt(inv.subtotal_minor),
          fmtAmt(inv.vat_amount_minor),
          fmtAmt(inv.total_minor),
          inv.currency,
        ].join(';'),
      );
      const csv = [header, ...dataRows].join('\r\n');

      return new Response('﻿' + csv, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="money-s3-${from}-${to}.csv"`,
          'Cache-Control': 'no-store',
        },
      });
    }

    const header =
      '"invoice_number","issue_date","due_date","customer_name","customer_address","customer_ico","customer_dic","customer_email","subtotal","vat","total","currency"';
    const dataRows = rows.map((inv) =>
      [
        escapeCsv(inv.invoice_number),
        inv.issue_date,
        inv.due_date,
        escapeCsv(inv.customer_name),
        escapeCsv(inv.customer_address),
        escapeCsv(inv.customer_ico),
        escapeCsv(inv.customer_dic),
        escapeCsv(inv.customer_email),
        fmtAmt(inv.subtotal_minor),
        fmtAmt(inv.vat_amount_minor),
        fmtAmt(inv.total_minor),
        inv.currency,
      ].join(','),
    );
    const csv = [header, ...dataRows].join('\r\n');

    return new Response('﻿' + csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="tixly-invoices-${from}-${to}.csv"`,
        'Cache-Control': 'no-store',
      },
    });
  });
}
