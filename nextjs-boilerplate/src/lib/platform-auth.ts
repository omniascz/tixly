import { jwtVerify } from 'jose';
import { NextRequest, NextResponse } from 'next/server';
import { runWithPlatformAdminContext } from './db/rls-pool';

const secretKey = new TextEncoder().encode(
  process.env.JWT_SECRET ?? 'dev-secret-change-me-min-32-chars-please',
);

export async function requirePlatformAdmin(
  req: NextRequest,
): Promise<{ userId: string } | null> {
  const auth = req.headers.get('authorization');
  const token = auth?.toLowerCase().startsWith('bearer ')
    ? auth.slice(7)
    : req.cookies.get('accessToken')?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey);
    const roles = (payload as { roles?: { isPlatformAdmin?: boolean } }).roles;
    if (!roles?.isPlatformAdmin) return null;
    const sub = payload.sub;
    if (!sub) return null;
    return { userId: sub };
  } catch {
    return null;
  }
}

/**
 * Convenience: requirePlatformAdmin + run v RLS bypass context.
 *
 *   export async function GET(req: NextRequest) {
 *     return runAsPlatformAdmin(req, async (admin) => {
 *       // Všechny db().query() calls automaticky bypass RLS
 *       const r = await pool.query('SELECT * FROM catalog.events');
 *       return NextResponse.json(r.rows);
 *     });
 *   }
 */
export async function runAsPlatformAdmin<T>(
  req: NextRequest,
  callback: (admin: { userId: string }) => Promise<T>,
): Promise<T | Response> {
  const admin = await requirePlatformAdmin(req);
  if (!admin) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }
  return runWithPlatformAdminContext(async () => callback(admin));
}
