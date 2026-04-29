import { NextRequest } from 'next/server';
import { jwtVerify } from 'jose';

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
    const sub = payload.sub as string | undefined;
    if (!sub) return null;
    return { userId: sub };
  } catch {
    return null;
  }
}
