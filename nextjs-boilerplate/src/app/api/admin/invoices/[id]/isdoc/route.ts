/**
 * GET /api/admin/invoices/[id]/isdoc
 *
 * Vrátí jednu fakturu jako ISDOC 6.0.2 XML (Pohoda/Money S3/Helios import).
 * Content-Type: application/isdoc + .isdoc filename.
 *
 * Auth: požaduje promoter session co vlastní fakturu.
 */
import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { requirePromoter } from '@/lib/admin-auth';
import { buildIsdocXml, IsdocInvoiceData } from '@/lib/accounting/isdoc';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const promoter = await requirePromoter(req);
  if (!promoter) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

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
  }>(
    `SELECT i.invoice_number,
            i.issue_date::text,
            i.due_date::text,
            i.subtotal_minor, i.vat_rate_pct, i.vat_amount_minor, i.total_minor, i.currency,
            i.customer_name, i.customer_email, i.customer_address, i.customer_ico, i.customer_dic,
            p.name AS promoter_name,
            p.ico AS promoter_ico, p.dic AS promoter_dic,
            p.legal_address AS promoter_address,
            p.bank_account AS promoter_bank_account,
            p.iban AS promoter_iban,
            p.contact_email AS promoter_email
     FROM orders.invoices i
     JOIN platform.promoters p ON p.id = i.promoter_id
     WHERE i.id = $1 AND i.promoter_id = $2`,
    [id, promoter.promoterId],
  );

  if (invRes.rows.length === 0) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const inv = invRes.rows[0];

  // Parse address (single-line: "Street, City ZIP") nebo fallback
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

  // Convert minor units (haléře) → CZK decimal
  const toDecimal = (minor: number): number => Math.round(minor) / 100;

  const data: IsdocInvoiceData = {
    invoiceNumber: inv.invoice_number,
    issueDate: inv.issue_date,
    taxableSupplyDate: inv.issue_date, // simplified: DUZP = issue date
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
    // Single line (vstupné + servisní poplatek nesplit — v M2 můžeme rozbít po ticket_type)
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
  };

  const xml = buildIsdocXml(data);

  return new NextResponse(xml, {
    status: 200,
    headers: {
      'Content-Type': 'application/isdoc; charset=utf-8',
      'Content-Disposition': `attachment; filename="${inv.invoice_number}.isdoc"`,
    },
  });
}
