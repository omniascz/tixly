import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getServiceDeps } from '../../../../../lib/service-container.js';
import { listInvoices, generateMonthlyInvoice } from '../../../../../services/invoice.service.js';
import { isBillingError } from '../../../../../lib/billing-errors.js';
import type { InvoiceStatus } from '../../../../../types/billing.js';

const generateSchema = z.object({
  period: z.string().regex(/^\d{4}-\d{2}$/, 'Formát musí být YYYY-MM'),
  dueInDays: z.number().int().min(1).max(365).optional(),
  notes: z.string().max(2000).optional(),
});

function requireAuth(req: NextRequest) {
  const userId = req.headers.get('x-user-id');
  if (!userId) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  return null;
}

/** GET /promoters/[promoterId]/invoices?status=&year= */
export async function GET(
  req: NextRequest,
  { params }: { params: { promoterId: string } },
) {
  const authErr = requireAuth(req);
  if (authErr) return authErr;

  try {
    const url = new URL(req.url);
    const status = url.searchParams.get('status') as InvoiceStatus | null;
    const year = url.searchParams.get('year');

    const deps = getServiceDeps();
    const invoices = await listInvoices(
      params.promoterId,
      { status: status ?? undefined, year: year ? Number(year) : undefined },
      deps.db,
    );
    return NextResponse.json({ items: invoices, total: invoices.length });
  } catch (err) {
    if (isBillingError(err)) return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    throw err;
  }
}

/** POST /promoters/[promoterId]/invoices — generate monthly invoice */
export async function POST(
  req: NextRequest,
  { params }: { params: { promoterId: string } },
) {
  const authErr = requireAuth(req);
  if (authErr) return authErr;

  try {
    const body = await req.json();
    const parsed = generateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'VALIDATION_ERROR', issues: parsed.error.issues },
        { status: 400 },
      );
    }

    const deps = getServiceDeps();
    const invoice = await generateMonthlyInvoice(
      { promoterId: params.promoterId, ...parsed.data },
      deps.db,
    );
    return NextResponse.json(invoice, { status: 201 });
  } catch (err) {
    if (isBillingError(err)) return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    throw err;
  }
}
