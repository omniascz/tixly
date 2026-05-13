import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { addNote } from '../../../../services/cs-extended.service.js';
import { isCsError, CsError } from '../../../../lib/cs-errors.js';
import type { CsExtDeps } from '../../../../services/cs-extended.service.js';

const NoteBody = z.object({
  entityType: z.string().min(1),
  entityId:   z.string().uuid(),
  note:       z.string().min(3),
});

function requireAdmin(req: NextRequest): string | null {
  const userId = req.headers.get('x-user-id');
  const isAdmin = req.headers.get('x-is-admin');
  if (!userId || isAdmin !== 'true') return null;
  return userId;
}

export function makeAddNoteHandler(deps: CsExtDeps) {
  return async function POST(req: NextRequest) {
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

    const parsed = NoteBody.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'VALIDATION_ERROR', message: parsed.error.message },
        { status: 400 },
      );
    }

    try {
      await addNote(parsed.data.entityType, parsed.data.entityId, parsed.data.note, csUserId, deps);
      return NextResponse.json({ success: true });
    } catch (err) {
      if (isCsError(err)) {
        return NextResponse.json(err.toHttpError(), { status: err.statusCode });
      }
      throw err;
    }
  };
}

export async function POST(req: NextRequest) {
  return NextResponse.json({ error: 'DB_NOT_INJECTED' }, { status: 500 });
}
