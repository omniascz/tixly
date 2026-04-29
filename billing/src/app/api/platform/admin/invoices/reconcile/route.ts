import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getServiceDeps } from '../../../../../../lib/service-container.js';
import { markInvoicePaidFromBankTx } from '../../../../../../services/invoice.service.js';
import { isBillingError } from '../../../../../../lib/billing-errors.js';

const bodySchema = z.object({
  invoiceNumber: z.string().min(1),
  txAmountHalire: z.number().int().nonnegative(),
  paidAt: z.string().datetime().optional(),
});

/**
 * POST /platform/admin/invoices/reconcile
 *
 * Reconciliation hook called by bank-reconciliation module (or admin UI) when
 * an incoming bank transaction matches an invoice number. Transitions the
 * invoice to 'paid' if the amount matches, otherwise returns 422.
 *
 * Auth: shared secret via x-reconcile-secret header OR admin header.
 */
export async function POST(req: NextRequest) {
  const adminId = req.headers.get('x-admin-user-id');
  const secret = req.headers.get('x-reconcile-secret');
  const expectedSecret = process.env.RECONCILE_SECRET;

  const authorized =
    !!adminId || (expectedSecret && secret === expectedSecret);
  if (!authorized) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'VALIDATION_ERROR', issues: parsed.error.issues },
      { status: 400 },
    );
  }

  try {
    const deps = getServiceDeps();
    const paidAt = parsed.data.paidAt ?? new Date().toISOString();
    const invoice = await markInvoicePaidFromBankTx(
      parsed.data.invoiceNumber,
      parsed.data.txAmountHalire,
      paidAt,
      deps.db,
    );
    return NextResponse.json({ invoice });
  } catch (err) {
    if (isBillingError(err)) {
      return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    }
    throw err;
  }
}
