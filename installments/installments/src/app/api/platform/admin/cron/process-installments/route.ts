import { NextRequest, NextResponse } from 'next/server';
import { InstallmentService } from '../../../../../../services/installment.service';
import type {
  InstallmentDbAdapter,
  GoPayAdapter,
} from '../../../../../../services/installment.service';

/**
 * POST /api/platform/admin/cron/process-installments
 *
 * HTTP-triggered dunning pass — runs the same logic as the node-cron job
 * `InstallmentChargeJob.run()`. Protected by `CRON_SECRET`.
 *
 * Retries overdue installment payments via GoPay recurring charge up to 3
 * times. After 3 failed attempts the schedule is cancelled and the ticket
 * released back to inventory.
 *
 * This route exists so that a serverless Next.js deployment (Vercel /
 * Kubernetes CronJob) can hit the dunning logic over HTTP without running
 * a long-lived node process.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json(
      { error: 'CRON_SECRET not configured' },
      { status: 500 },
    );
  }
  if (request.headers.get('x-cron-secret') !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const deps = await loadDeps();
  if (!deps) {
    return NextResponse.json(
      { error: 'InstallmentDeps not configured — set INSTALLMENT_DEPS_MODULE env var' },
      { status: 500 },
    );
  }

  try {
    const service = new InstallmentService();
    const result = await service.processOverduePayments(deps.db, deps.gopay);
    return NextResponse.json({
      charged: result.charged,
      failed: result.failed,
      cancelled: result.cancelled,
      runAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[cron process-installments]', err);
    return NextResponse.json(
      { error: 'InternalServerError' },
      { status: 500 },
    );
  }
}

interface InstallmentDeps {
  db: InstallmentDbAdapter;
  gopay: GoPayAdapter;
}

/**
 * Dynamically imports the deployment-supplied deps module. The module must
 * export a `getInstallmentDeps()` function returning `{ db, gopay }`. We keep
 * this indirection so the installments package itself stays free of DB and
 * GoPay concrete clients.
 */
async function loadDeps(): Promise<InstallmentDeps | null> {
  const modulePath = process.env.INSTALLMENT_DEPS_MODULE;
  if (!modulePath) return null;
  try {
    const mod = (await import(modulePath)) as {
      getInstallmentDeps?: () => InstallmentDeps;
    };
    return mod.getInstallmentDeps?.() ?? null;
  } catch (err) {
    console.error('[cron process-installments] failed to load deps module:', err);
    return null;
  }
}
