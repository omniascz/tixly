import { NextRequest, NextResponse } from 'next/server';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';
import { runAsUser } from '@/lib/auth';
import { buildInvoicePdf } from '@/lib/accounting/invoice-pdf';
import type { IsdocInvoiceData } from '@/lib/accounting/isdoc';

function parseAddr(s: string | null): { street: string; city: string; zip: string } {
  if (!s) return { street: '', city: '', zip: '' };
  const parts = s.split(',').map((p) => p.trim());
  if (parts.length >= 2) {
    const cityZip = parts[parts.length - 1].match(/^(.+?)\s+(\d{3}\s?\d{2})$/);
    if (cityZip) {
      return { street: parts[0], city: cityZip[1].trim(), zip: cityZip[2].replace(/\s/g, '') };
    }
  }
  return { street: s, city: '', zip: '' };
}

const toDecimal = (minor: number): number => Math.round(minor) / 100;

export async function GET(
  req: NextRequest,
  { params }: { params: { orderId: string } },
): Promise<Response> {
  return runAsUser(req, async (userId) => {
    const { orderId } = params;
    if (!/^[0-9a-f-]{36}$/i.test(orderId)) {
      return NextResponse.json({ error: 'INVALID_ID' }, { status: 400 });
    }

    const orderRes = await db().query<{
      id: string;
      total_amount: number;
      currency: string;
      event_id: string;
    }>(
      `SELECT id, total_amount, currency, event_id
       FROM orders.orders
       WHERE id = $1 AND user_id = $2 AND status = 'paid'`,
      [orderId, userId],
    );
    if (orderRes.rows.length === 0) {
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    }
    const order = orderRes.rows[0];

    const eventRes = await db().query<{ promoter_id: string }>(
      `SELECT promoter_id FROM catalog.events WHERE id = $1`,
      [order.event_id],
    );
    if (eventRes.rows.length === 0) {
      return NextResponse.json({ error: 'EVENT_NOT_FOUND' }, { status: 404 });
    }
    const promoterId = eventRes.rows[0].promoter_id;

    const existingRes = await db().query<{
      id: string;
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
    }>(
      `SELECT id, invoice_number, issue_date::text, due_date::text,
              subtotal_minor, vat_rate_pct, vat_amount_minor, total_minor, currency,
              customer_name, customer_email, customer_address, customer_ico, customer_dic
       FROM orders.invoices
       WHERE order_id = $1 AND promoter_id = $2
       LIMIT 1`,
      [orderId, promoterId],
    );

    type InvRow = (typeof existingRes.rows)[0];
    let invoiceData: InvRow;

    if (existingRes.rows.length > 0) {
      invoiceData = existingRes.rows[0];
    } else {
      invoiceData = await runWithServiceContext(async () => {
        const userRes = await db().query<{ name: string; email: string }>(
          `SELECT name, email FROM identity.users WHERE id = $1`,
          [userId],
        );
        const user = userRes.rows[0] ?? { name: userId, email: '' };

        const promVatRes = await db().query<{ vat_rate_pct: number }>(
          `SELECT vat_rate_pct FROM platform.promoters WHERE id = $1`,
          [promoterId],
        );
        const vatRate = promVatRes.rows[0]?.vat_rate_pct ?? 0;

        const totalGross = order.total_amount;
        const subtotal = Math.round((totalGross * 100) / (100 + vatRate));
        const vatAmount = totalGross - subtotal;

        const year = new Date().getFullYear();
        const seqRes = await db().query<{ next: string }>(
          `SELECT COALESCE(
             (SELECT MAX(SPLIT_PART(invoice_number, '-', 2)::int)::text
              FROM orders.invoices
              WHERE promoter_id = $1 AND invoice_number LIKE $2),
             '0'
           ) AS next`,
          [promoterId, `${year}-%`],
        );
        const nextNum = String(Number(seqRes.rows[0].next) + 1).padStart(4, '0');
        const invoiceNumber = `${year}-${nextNum}`;

        const dueDate = new Date();
        dueDate.setDate(dueDate.getDate() + 14);

        const insRes = await db().query<{ id: string }>(
          `INSERT INTO orders.invoices
             (order_id, promoter_id, invoice_number, due_date,
              subtotal_minor, vat_rate_pct, vat_amount_minor, total_minor, currency,
              customer_name, customer_email)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
           RETURNING id`,
          [
            orderId,
            promoterId,
            invoiceNumber,
            dueDate.toISOString().slice(0, 10),
            subtotal,
            vatRate,
            vatAmount,
            totalGross,
            order.currency,
            user.name,
            user.email || null,
          ],
        );

        const refetchRes = await db().query<InvRow>(
          `SELECT id, invoice_number, issue_date::text, due_date::text,
                  subtotal_minor, vat_rate_pct, vat_amount_minor, total_minor, currency,
                  customer_name, customer_email, customer_address, customer_ico, customer_dic
           FROM orders.invoices WHERE id = $1`,
          [insRes.rows[0].id],
        );
        return refetchRes.rows[0];
      });
    }

    const promRes = await db().query<{
      name: string;
      company_ico: string | null;
      company_dic: string | null;
      company_address: string | null;
      bank_account: string | null;
      contact_email: string | null;
    }>(
      `SELECT name, company_ico, company_dic, company_address, bank_account, contact_email
       FROM platform.promoters WHERE id = $1`,
      [promoterId],
    );
    const prom = promRes.rows[0];

    const supplierAddr = parseAddr(prom?.company_address ?? null);
    const customerAddr = parseAddr(invoiceData.customer_address);

    const data: IsdocInvoiceData = {
      invoiceNumber: invoiceData.invoice_number,
      issueDate: invoiceData.issue_date,
      taxableSupplyDate: invoiceData.issue_date,
      dueDate: invoiceData.due_date,
      supplier: {
        name: prom?.name ?? '',
        ico: prom?.company_ico ?? '',
        dic: prom?.company_dic ?? undefined,
        address: {
          street: supplierAddr.street,
          city: supplierAddr.city,
          zip: supplierAddr.zip,
          country: 'CZ',
        },
        bankAccount: prom?.bank_account ?? undefined,
        email: prom?.contact_email ?? undefined,
      },
      customer: {
        name: invoiceData.customer_name,
        ico: invoiceData.customer_ico ?? undefined,
        dic: invoiceData.customer_dic ?? undefined,
        address: invoiceData.customer_address
          ? {
              street: customerAddr.street,
              city: customerAddr.city,
              zip: customerAddr.zip,
              country: 'CZ',
            }
          : undefined,
        email: invoiceData.customer_email ?? undefined,
      },
      lines: [
        {
          description: `Vstupenky — faktura ${invoiceData.invoice_number}`,
          quantity: 1,
          unitPriceWithoutVat: toDecimal(invoiceData.subtotal_minor),
          vatRatePct: invoiceData.vat_rate_pct,
        },
      ],
      currency: invoiceData.currency,
      subtotal: toDecimal(invoiceData.subtotal_minor),
      vatAmount: toDecimal(invoiceData.vat_amount_minor),
      total: toDecimal(invoiceData.total_minor),
      paymentMeans: 'card',
      variableSymbol: invoiceData.invoice_number.replace(/-/g, ''),
    };

    const pdfBuf = await buildInvoicePdf(data);

    return new Response(new Uint8Array(pdfBuf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="faktura-${invoiceData.invoice_number}.pdf"`,
        'Cache-Control': 'no-store',
      },
    });
  });
}
