/**
 * GET /api/admin/invoices/[id]/pdf
 *
 * Vrátí fakturu jako PDF (A4, česky, NotoSans diakritika).
 * Stejná data jako /isdoc endpoint — sdílíme query + IsdocInvoiceData.
 *
 * Auth: promoter session vlastnící fakturu.
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsPromoterNonStaff } from '@/lib/admin-auth';
import { buildInvoicePdf } from '@/lib/accounting/invoice-pdf';
import type { IsdocInvoiceData } from '@/lib/accounting/isdoc';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return runAsPromoterNonStaff(req, async (promoter) => {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: 'INVALID_ID' }, { status: 400 });
  }

  const invRes = await db().query<{
    invoice_number: string;
    issue_date: string;
    due_date: string;
    subtotal_minor: number;
    vat_rate_pct: number;
    vat_amount_minor: number;
    total_minor: number;
    currency: string;
    customer_name: string;
    customer_email: string | null;
    customer_address: string | null;
    customer_ico: string | null;
    customer_dic: string | null;
    promoter_name: string;
    promoter_ico: string | null;
    promoter_dic: string | null;
    promoter_address: string | null;
    promoter_bank_account: string | null;
    promoter_iban: string | null;
    promoter_email: string | null;
    is_reverse_charge: boolean;
    buyer_vat_number: string | null;
  }>(
    `SELECT i.invoice_number,
            i.issue_date::text,
            i.due_date::text,
            i.subtotal_minor, i.vat_rate_pct, i.vat_amount_minor, i.total_minor, i.currency,
            i.customer_name, i.customer_email, i.customer_address, i.customer_ico, i.customer_dic,
            p.name AS promoter_name,
            p.company_ico AS promoter_ico, p.company_dic AS promoter_dic,
            p.company_address AS promoter_address,
            p.bank_account AS promoter_bank_account,
            NULL::text AS promoter_iban,
            p.contact_email AS promoter_email,
            COALESCE(o.is_reverse_charge, FALSE) AS is_reverse_charge,
            o.buyer_vat_number
     FROM orders.invoices i
     JOIN platform.promoters p ON p.id = i.promoter_id
     LEFT JOIN orders.orders o ON o.id = i.order_id
     WHERE i.id = $1 AND i.promoter_id = $2`,
    [id, promoter.promoterId],
  );

  if (invRes.rows.length === 0) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const inv = invRes.rows[0];

  const parseAddr = (s: string | null): { street: string; city: string; zip: string } => {
    if (!s) return { street: '', city: '', zip: '' };
    const parts = s.split(',').map((p) => p.trim());
    if (parts.length >= 2) {
      const cityZip = parts[parts.length - 1].match(/^(.+?)\s+(\d{3}\s?\d{2})$/);
      if (cityZip) return { street: parts[0], city: cityZip[1].trim(), zip: cityZip[2].replace(/\s/g, '') };
    }
    return { street: s, city: '', zip: '' };
  };

  const supplierAddr = parseAddr(inv.promoter_address);
  const customerAddr = parseAddr(inv.customer_address);
  const toDecimal = (minor: number): number => Math.round(minor) / 100;

  const data: IsdocInvoiceData = {
    invoiceNumber: inv.invoice_number,
    issueDate: inv.issue_date,
    taxableSupplyDate: inv.issue_date,
    dueDate: inv.due_date,
    supplier: {
      name: inv.promoter_name,
      ico: inv.promoter_ico ?? '',
      dic: inv.promoter_dic ?? undefined,
      address: {
        street: supplierAddr.street,
        city: supplierAddr.city,
        zip: supplierAddr.zip,
        country: 'CZ',
      },
      bankAccount: inv.promoter_bank_account ?? undefined,
      iban: inv.promoter_iban ?? undefined,
      email: inv.promoter_email ?? undefined,
    },
    customer: {
      name: inv.customer_name,
      ico: inv.customer_ico ?? undefined,
      dic: inv.customer_dic ?? undefined,
      address: inv.customer_address
        ? {
            street: customerAddr.street,
            city: customerAddr.city,
            zip: customerAddr.zip,
            country: 'CZ',
          }
        : undefined,
      email: inv.customer_email ?? undefined,
    },
    lines: [
      {
        description: `Vstupenky — faktura ${inv.invoice_number}`,
        quantity: 1,
        unitPriceWithoutVat: toDecimal(inv.subtotal_minor),
        vatRatePct: inv.vat_rate_pct,
      },
    ],
    currency: inv.currency,
    subtotal: toDecimal(inv.subtotal_minor),
    vatAmount: toDecimal(inv.vat_amount_minor),
    total: toDecimal(inv.total_minor),
    paymentMeans: 'transfer',
    variableSymbol: inv.invoice_number.replace(/-/g, ''),
    isReverseCharge: inv.is_reverse_charge,
    reverseChargeNote: inv.is_reverse_charge
      ? `Přenesená daňová povinnost (DIČ kupce: ${inv.buyer_vat_number ?? 'N/A'}) – Article 44, Council Directive 2006/112/EC.`
      : undefined,
  };

  const pdfBuf = await buildInvoicePdf(data);

  return new Response(new Uint8Array(pdfBuf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${inv.invoice_number}.pdf"`,
      'Cache-Control': 'no-store',
    },
  });

  });
}
