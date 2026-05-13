import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { transferTicket } from '../../../../../../services/cs.service';
import { isCsError, CsError } from '../../../../../../lib/cs-errors';

const TransferBody = z.object({
  toEmail: z.string().email(),
  toName:  z.string().optional(),
  reason:  z.string().optional(),
});

export function makeTransferHandler(deps: Parameters<typeof transferTicket>[1]) {
  return async function POST(
    req: NextRequest,
    { params }: { params: { ticketId: string } },
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
      return NextResponse.json({ error: 'INVALID_JSON', message: 'Invalid JSON body' }, { status: 400 });
    }

    const parsed = TransferBody.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'VALIDATION_ERROR', message: parsed.error.message },
        { status: 400 },
      );
    }

    try {
      const ticket = await transferTicket(params.ticketId, { ...parsed.data, agentId }, deps);
      return NextResponse.json(ticket);
    } catch (err) {
      if (isCsError(err)) {
        return NextResponse.json(err.toHttpError(), { status: err.statusCode });
      }
      throw err;
    }
  };
}
