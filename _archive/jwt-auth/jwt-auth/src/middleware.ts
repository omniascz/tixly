import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';

// Edge Runtime — nesmí importovat Node.js-only moduly.
// Middleware pouze validuje token a přidává hlavičky pro kompatibilitu.

function getSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('JWT_SECRET missing or too short');
  }
  return new TextEncoder().encode(secret);
}

interface AccessPayload {
  sub: string;
  isAdmin: boolean;
}

async function verifyTokenEdge(token: string): Promise<AccessPayload | null> {
  try {
    const secret = getSecret();
    const { payload } = await jwtVerify(token, secret, {
      algorithms: ['HS256'],
      issuer: 'tixly',
      audience: 'tixly-api',
    });

    const sub = typeof payload.sub === 'string' ? payload.sub : null;
    const isAdmin = typeof payload.isAdmin === 'boolean' ? payload.isAdmin : false;

    if (!sub) return null;

    return { sub, isAdmin };
  } catch {
    return null;
  }
}

function unauthorizedResponse(message: string): NextResponse {
  return new NextResponse(
    JSON.stringify({ error: { code: 'TOKEN_MISSING', message } }),
    {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    }
  );
}

function invalidTokenResponse(): NextResponse {
  return new NextResponse(
    JSON.stringify({ error: { code: 'TOKEN_INVALID', message: 'Token is invalid or expired' } }),
    {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    }
  );
}

// Routes veřejně přístupné pouze pro čtení (GET).
// Mutační metody (POST, PUT, PATCH, DELETE) vždy vyžadují autentizaci.
const PUBLIC_READ_ROUTES = [
  '/api/auth/',
  '/api/events/',
];

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;

  // Public routes jsou veřejné jen pro čtení (GET)
  const isPublicRoute = PUBLIC_READ_ROUTES.some(r => pathname.startsWith(r));
  if (isPublicRoute && request.method === 'GET') {
    return NextResponse.next();
  }

  // Protected route groups — all API routes require auth EXCEPT public read routes above.
  // /api/events/ is public for GET but mutations (POST/PUT/PATCH/DELETE) require auth.
  const requiresAuth =
    (pathname.startsWith('/api/events/') && request.method !== 'GET') ||
    pathname.startsWith('/api/platform/') ||
    pathname.startsWith('/api/orders/') ||
    pathname.startsWith('/api/tickets/') ||
    pathname.startsWith('/api/resale/') ||
    pathname.startsWith('/api/passes/') ||
    pathname.startsWith('/api/organizer/') ||
    pathname.startsWith('/api/users/') ||
    pathname.startsWith('/api/watchlist/');

  if (!requiresAuth) {
    return NextResponse.next();
  }

  // Extract Bearer token
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return unauthorizedResponse('Authorization header is missing');
  }

  const token = authHeader.split(' ')[1];
  if (!token) {
    return unauthorizedResponse('Bearer token is missing');
  }

  const payload = await verifyTokenEdge(token);
  if (!payload) {
    return invalidTokenResponse();
  }

  // /api/platform/admin/* requires isAdmin = true
  if (pathname.startsWith('/api/platform/admin/') && !payload.isAdmin) {
    return new NextResponse(
      JSON.stringify({ error: { code: 'ADMIN_REQUIRED', message: 'Platform admin access required' } }),
      {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  // Forward decoded identity via headers for backward compatibility with existing modules.
  // Detailed RBAC (promoter membership, roles) is enforced in route handlers via requirePromoterMember().
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-user-id', payload.sub);
  requestHeaders.set('x-is-admin', payload.isAdmin ? 'true' : 'false');

  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: ['/api/:path*'],
};
