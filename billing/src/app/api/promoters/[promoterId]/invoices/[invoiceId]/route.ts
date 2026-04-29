import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getServiceDeps } from '../../../../../../lib/service-container.js';
import { getInvoice, updateInvoice, voidInvoice } from '../../../../../../services/invoice.service.js';
import { isBillingError } from '../../../../../../lib/billing-errors.js';

const updateSchema = z.object({
  status: z.enum(['draft', 'issued', 'paid', 'overdue', 'void']).optional(),
  paidAt: z.string().datetime().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

function requireAuth(req: NextRequest) {
  const userId = req.headers.get('x-user-id');
  if (!userId) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  return null;
}

/** GET /promoters/[promoterId]/invoices/[invoiceId] */
export async function GET(
  req: NextRequest,
  { params }: { params: { promoterId: string; invoiceId: string } },
) {
  const authErr = requireAuth(req);
  if (authErr) return authErr;

  try {
    const deps = getServiceDeps();
    const invoice = await getInvoice(params.invoiceId, params.promoterId, deps.db);
    return NextResponse.json(invoice);
  } catch (err) {
    if (isBillingError(err)) return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    throw err;
  }
}

/** DELETE /promoters/[promoterId]/invoices/[invoiceId] — void the invoice (reason in query/body) */
export async function DELETE(
  req: NextRequest,
  { params }: { params: { promoterId: string; invoiceId: string } },
) {
  const authErr = requireAuth(req);
  if (authErr) return authErr;

  try {
    let reason = new URL(req.url).searchParams.get('reason') ?? '';
    if (!reason) {
      try {
        const body = (await req.json()) as { reason?: string };
        reason = body.reason ?? '';
      } catch {
        /* no body */
      }
    }
    if (!reason.trim()) {
      return NextResponse.json(
        { error: 'VALIDATION_ERROR', message: 'reason is required' },
        { status: 400 },
      );
    }
    const deps = getServiceDeps();
    const invoice = await voidInvoice(
      params.invoiceId,
      params.promoterId,
      reason.trim(),
      deps.db,
    );
    return NextResponse.json(invoice);
  } catch (err) {
    if (isBillingError(err)) return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    throw err;
  }
}

/** PATCH /promoters/[promoterId]/invoices/[invoiceId] — update status/notes */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { promoterId: string; invoiceId: string } },
) {
  const authErr = requireAuth(req);
  if (authErr) return authErr;

  try {
    const body = await req.json();
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'VALIDATION_ERROR', issues: parsed.error.issues },
        { status: 400 },
      );
    }
    const deps = getServiceDeps();
    const invoice = await updateInvoice(params.invoiceId, params.promoterId, parsed.data, deps.db);
    return NextResponse.json(invoice);
  } catch (err) {
    if (isBillingError(err)) return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    throw err;
  }
}
