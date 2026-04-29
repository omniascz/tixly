import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { refundOrder } from '../../../../../../services/cs.service.js';
import { issueRefund } from '../../../../../../services/cs-extended.service.js';
import { isCsError, CsError } from '../../../../../../lib/cs-errors.js';
import type { CsExtDeps } from '../../../../../../services/cs-extended.service.js';

const RefundBody = z.object({
  amount: z.number().int().positive(),
  reason: z.string().min(5),
});

function requireAdmin(req: NextRequest): string | null {
  const userId = req.headers.get('x-user-id');
  const isAdmin = req.headers.get('x-is-admin');
  if (!userId || isAdmin !== 'true') return null;
  return userId;
}

// Legacy factory (uses old cs.service refundOrder)
export function makeRefundHandler(deps: Parameters<typeof refundOrder>[2]) {
  return async function POST(
    req: NextRequest,
    { params }: { params: { orderId: string } },
  ) {
    const agentId = req.headers.get('x-cs-agent-id');
    if (!agentId) {
      const err = new CsError('UNAUTHORIZED');
      return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'INVALID_JSON', message: 'Neplatné JSON tělo' }, { status: 400 });
    }

    const parsed = RefundBody.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'VALIDATION_ERROR', message: parsed.error.message },
        { status: 400 },
      );
    }

    try {
      const result = await refundOrder(params.orderId, { ...parsed.data, agentId }, deps);
      return NextResponse.json(result);
    } catch (err) {
      if (isCsError(err)) {
        return NextResponse.json(err.toHttpError(), { status: err.statusCode });
      }
      throw err;
    }
  };
}

// Admin-only factory (uses extended issueRefund)
export function makeIssueRefundHandler(deps: CsExtDeps) {
  return async function POST(
    req: NextRequest,
    { params }: { params: { orderId: string } },
  ) {
    const csUserId = requireAdmin(req);
    if (!csUserId) {
      const err = new CsError('FORBIDDEN');
      return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'INVALID_JSON', message: 'Neplatné JSON tělo' }, { status: 400 });
    }

    const parsed = RefundBody.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'VALIDATION_ERROR', message: parsed.error.message },
        { status: 400 },
      );
    }

    try {
      const result = await issueRefund(params.orderId, parsed.data.amount, parsed.data.reason, csUserId, deps);
      return NextResponse.json(result);
    } catch (err) {
      if (isCsError(err)) {
        return NextResponse.json(err.toHttpError(), { status: err.statusCode });
      }
      throw err;
    }
  };
}
