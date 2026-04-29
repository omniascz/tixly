import { NextRequest, NextResponse } from 'next/server';
import { isRefundError } from '../../../../../lib/refund-errors';
import { listRequestsForUser } from '../../../../../services/refund-request.service';
import { paginationSchema } from '../../../../../lib/zod-schemas';
import type { ServiceDeps } from '../../../../../lib/service-container';

function getDeps(): ServiceDeps {
  throw new Error('ServiceDeps not wired — use dependency injection');
}

// In production, userId is extracted from the JWT token
const extractUserId = (authHeader: string): string | null => {
  // Placeholder — real implementation decodes JWT
  const token = authHeader.replace('Bearer ', '');
  if (!token) return null;
  return token; // real: jwt.verify(token).sub
};

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Missing token' } }, { status: 401 });
  }

  const userId = extractUserId(authHeader);
  if (!userId) {
    return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Invalid token' } }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const queryObj: Record<string, string> = {};
    searchParams.forEach((v, k) => { queryObj[k] = v; });

    const validated = paginationSchema.safeParse(queryObj);
    if (!validated.success) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: validated.error.message } },
        { status: 400 },
      );
    }

    const deps = getDeps();
    const requests = await listRequestsForUser(
      userId,
      { limit: validated.data.limit, offset: validated.data.offset },
      deps,
    );
    return NextResponse.json(requests, { status: 200 });
  } catch (err) {
    if (isRefundError(err)) {
      return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    }
    return NextResponse.json({ error: { code: 'INTERNAL', message: 'Interní chyba serveru' } }, { status: 500 });
  }
}
