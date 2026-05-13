import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getServiceDeps } from '../../../../../lib/service-container.js';
import { listAllInvoices } from '../../../../../services/invoice.service.js';
import { isBillingError } from '../../../../../lib/billing-errors.js';

const querySchema = z.object({
  status: z.enum(['draft', 'issued', 'paid', 'overdue', 'void']).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

/**
 * GET /platform/admin/invoices
 * Admin endpoint — list all invoices across all promoters.
 * Requires x-admin-user-id header.
 */
export async function GET(req: NextRequest) {
  const adminId = req.headers.get('x-admin-user-id');
  if (!adminId) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  try {
    const url = new URL(req.url);
    const params = Object.fromEntries(url.searchParams);
    const parsed = querySchema.safeParse(params);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'VALIDATION_ERROR', issues: parsed.error.issues },
        { status: 400 },
      );
    }

    const deps = getServiceDeps();
    const result = await listAllInvoices(parsed.data, deps.db);
    return NextResponse.json(result);
  } catch (err) {
    if (isBillingError(err)) return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    throw err;
  }
}
