import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { addNote } from '../../../../../../services/cs.service';
import { isCsError, CsError } from '../../../../../../lib/cs-errors';

const NoteBody = z.object({
  note: z.string().min(3),
});

export function makeAddNoteHandler(deps: Parameters<typeof addNote>[2]) {
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
      return NextResponse.json({ error: 'INVALID_JSON', message: 'Invalid JSON body' }, { status: 400 });
    }

    const parsed = NoteBody.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'VALIDATION_ERROR', message: parsed.error.message },
        { status: 400 },
      );
    }

    try {
      await addNote(params.orderId, parsed.data.note, agentId, deps);
      return NextResponse.json({ success: true });
    } catch (err) {
      if (isCsError(err)) {
        return NextResponse.json(err.toHttpError(), { status: err.statusCode });
      }
      throw err;
    }
  };
}
