import { jwtVerify } from 'jose';
import { NextRequest, NextResponse } from 'next/server';
import { runWithPlatformAdminContext } from './db/rls-pool';

const secretKey = new TextEncoder().encode(
  process.env.JWT_SECRET ?? 'dev-secret-change-me-min-32-chars-please',
);

async function verifyAdminToken(token: string | null | undefined): Promise<{ userId: string } | null> {
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

export async function requirePlatformAdmin(
  req: NextRequest,
): Promise<{ userId: string } | null> {
  const auth = req.headers.get('authorization');
  const bearer = auth?.toLowerCase().startsWith('bearer ') ? auth.slice(7) : null;
  const cookie = req.cookies.get('accessToken')?.value ?? null;
  // Zkus Bearer; když je neplatný/vypršelý, spadni zpět na accessToken cookie
  // (prohlížeč ji posílá sám a obnovuje při loginu) — jinak vypršelý localStorage
  // token v authFetch hodí 401, i když je relace přes cookie platná.
  return (await verifyAdminToken(bearer)) ?? (await verifyAdminToken(cookie));
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
