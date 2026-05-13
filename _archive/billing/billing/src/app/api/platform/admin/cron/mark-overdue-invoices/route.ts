import { NextRequest, NextResponse } from 'next/server';
import { getServiceDeps } from '../../../../../../lib/service-container.js';
import { markOverdueInvoices } from '../../../../../../services/invoice.service.js';

/**
 * POST /platform/admin/cron/mark-overdue-invoices
 *
 * Dunning pass — promotes every 'issued' invoice past its due date to 'overdue'.
 * Scheduled daily. Protected by CRON_SECRET shared-secret header to block
 * external callers.
 */
export async function POST(req: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 });
  }
  if (req.headers.get('x-cron-secret') !== expected) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  const deps = getServiceDeps();
  const asOfDate = new Date().toISOString().slice(0, 10);
  const overdue = await markOverdueInvoices(asOfDate, deps.db);

  return NextResponse.json({
    markedOverdue: overdue.length,
    invoices: overdue.map((i) => ({
      id: i.id,
      invoiceNumber: i.invoiceNumber,
      promoterId: i.promoterId,
      totalHalire: i.totalHalire,
      dueDate: i.dueDate,
    })),
  });
}
