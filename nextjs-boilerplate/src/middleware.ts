import { jwtVerify } from 'jose';
import { NextRequest, NextResponse } from 'next/server';
import {
  detectLocale,
  getPathnameLocale,
  pathnameWithoutLocale,
  LOCALE_COOKIE,
} from '@/lib/i18n';

// ── JWT helpers (Edge Runtime — jose only) ───────────────────────────────────

function getSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('JWT_SECRET missing or too short');
  }
  return new TextEncoder().encode(secret);
}

interface JWTRoles {
  isPlatformAdmin?: boolean;
  promoterMemberships?: Array<{ promoterId: string; status: string; role: string }>;
}

interface AccessPayload {
  sub: string;
  isAdmin: boolean;
  roles: JWTRoles;
}

async function verifyTokenEdge(token: string): Promise<AccessPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret(), { algorithms: ['HS256'] });
    const sub = typeof payload.sub === 'string' ? payload.sub : null;
    if (!sub) return null;
    const roles = (payload as { roles?: JWTRoles }).roles ?? {};
    const isAdmin = roles.isPlatformAdmin === true;
    return { sub, isAdmin, roles };
  } catch {
    return null;
  }
}


function jsonResponse(body: object, status: number): NextResponse {
  return new NextResponse(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ── Route lists ─────────────────────────────────────────────────────────────

const API_AUTH_PREFIX = '/api/auth/';

const API_PUBLIC_GET_ROUTES = ['/api/events/', '/api/search', '/api/cross-passes/', '/api/subscriptions/plans', '/api/public/'];

// API routes that require auth + admin (platform admin OR promoter membership)
const API_PROMOTER_PREFIXES = ['/api/admin/', '/api/orders/'];
const API_PLATFORM_PREFIXES = ['/api/platform/'];
// Optional auth: token if present propagates as x-user-id, otherwise pass through
const API_OPTIONAL_AUTH_PREFIXES = ['/api/buyer/', '/api/checkout', '/api/subscriptions/', '/api/queue/'];

// Frontend routes (matched WITHOUT locale prefix)
const FRONTEND_PROMOTER = ['/admin'];
const FRONTEND_PLATFORM = ['/platform'];
const FRONTEND_AUTH_ONLY = ['/login', '/register', '/register-promoter'];

// Public mock-gopay endpoints (skip auth entirely, even in API)
const PUBLIC_API_PREFIXES = ['/api/health', '/api/internal/', '/api/mock-gopay', '/api/team/accept', '/api/lottery/', '/api/gift/', '/api/newsletter/', '/api/support/chat'];

// ── Middleware ──────────────────────────────────────────────────────────────

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;

  // Root → vždy /cs/events. Admin/promotér si otevře svůj workspace přes nav link "Admin".
  // Důvod: root je veřejná tvář produktu, neměla by se měnit podle role visitora.
  if (pathname === '/' || pathname === '/cs') {
    return NextResponse.redirect(new URL('/cs/events', request.url));
  }

  // ── 1. API routes ────────────────────────────────────────────────────────
  if (pathname.startsWith('/api/')) {
    if (pathname.startsWith(API_AUTH_PREFIX)) {
      return NextResponse.next();
    }
    if (PUBLIC_API_PREFIXES.some((r) => pathname.startsWith(r))) {
      return NextResponse.next();
    }

    const isPublicGet =
      API_PUBLIC_GET_ROUTES.some((r) => pathname.startsWith(r)) &&
      request.method === 'GET';
    if (isPublicGet) {
      return NextResponse.next();
    }

    const isPlatformApi = API_PLATFORM_PREFIXES.some((r) => pathname.startsWith(r));
    const isPromoterApi = API_PROMOTER_PREFIXES.some((r) => pathname.startsWith(r));
    const isOptionalAuthApi = API_OPTIONAL_AUTH_PREFIXES.some((r) =>
      pathname.startsWith(r),
    );

    if (!isPlatformApi && !isPromoterApi && !isOptionalAuthApi) {
      return NextResponse.next();
    }

    // Optional auth: if token present propagate user, else pass through unauthenticated
    if (isOptionalAuthApi) {
      const authHeader = request.headers.get('Authorization');
      const cookieToken = request.cookies.get('accessToken')?.value;
      const token =
        authHeader && authHeader.startsWith('Bearer ')
          ? authHeader.split(' ')[1]
          : cookieToken;
      if (!token) return NextResponse.next();
      const payload = await verifyTokenEdge(token);
      if (!payload) return NextResponse.next();
      const requestHeaders = new Headers(request.headers);
      requestHeaders.set('x-user-id', payload.sub);
      return NextResponse.next({ request: { headers: requestHeaders } });
    }

    // Extract token from Bearer header OR accessToken cookie
    const authHeader = request.headers.get('Authorization');
    const cookieToken = request.cookies.get('accessToken')?.value;
    const token =
      authHeader && authHeader.startsWith('Bearer ')
        ? authHeader.split(' ')[1]
        : cookieToken;

    if (!token) {
      return jsonResponse(
        { error: { code: 'TOKEN_MISSING', message: 'Authorization required' } },
        401,
      );
    }

    const payload = await verifyTokenEdge(token);
    if (!payload) {
      return jsonResponse(
        { error: { code: 'TOKEN_INVALID', message: 'Token invalid or expired' } },
        401,
      );
    }

    if (isPlatformApi && !payload.roles.isPlatformAdmin) {
      return jsonResponse(
        { error: { code: 'PLATFORM_ADMIN_REQUIRED', message: 'Platform admin access required' } },
        403,
      );
    }
    if (
      isPromoterApi &&
      !payload.roles.isPlatformAdmin &&
      !(payload.roles.promoterMemberships?.length)
    ) {
      return jsonResponse(
        { error: { code: 'PROMOTER_REQUIRED', message: 'Promoter membership required' } },
        403,
      );
    }

    const requestHeaders = new Headers(request.headers);
    requestHeaders.set('x-user-id', payload.sub);
    requestHeaders.set('x-is-admin', payload.isAdmin ? 'true' : 'false');
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  // ── 2. Frontend routes ───────────────────────────────────────────────────
  // /admin and /platform are NOT locale-prefixed
  if (
    FRONTEND_PROMOTER.some((r) => pathname === r || pathname.startsWith(r + '/')) ||
    FRONTEND_PLATFORM.some((r) => pathname === r || pathname.startsWith(r + '/'))
  ) {
    const accessToken = request.cookies.get('accessToken')?.value;
    if (!accessToken) {
      const loginUrl = new URL('/cs/login', request.url);
      loginUrl.searchParams.set('from', pathname);
      return NextResponse.redirect(loginUrl);
    }
    const payload = await verifyTokenEdge(accessToken);
    if (!payload) {
      const loginUrl = new URL('/cs/login', request.url);
      loginUrl.searchParams.set('from', pathname);
      return NextResponse.redirect(loginUrl);
    }
    const isPlatform = FRONTEND_PLATFORM.some(
      (r) => pathname === r || pathname.startsWith(r + '/'),
    );
    if (isPlatform && !payload.roles.isPlatformAdmin) {
      return NextResponse.redirect(new URL('/cs/events', request.url));
    }
    if (
      !isPlatform &&
      !payload.roles.isPlatformAdmin &&
      !(payload.roles.promoterMemberships?.length)
    ) {
      return NextResponse.redirect(new URL('/cs/events', request.url));
    }
    return NextResponse.next();
  }

  // Mock payment gateway pages live outside the [locale] segment
  // (src/app/mock-gopay/, /mock-wero/, /mock-przelewy24/, /mock-benefit/).
  // Locale prefix would redirect to /cs/mock-X/Y — which has no matching
  // route file and 404s. Pass through unchanged.
  if (
    pathname.startsWith('/mock-gopay/') ||
    pathname.startsWith('/mock-wero/') ||
    pathname.startsWith('/mock-przelewy24/') ||
    pathname.startsWith('/mock-benefit/') ||
    pathname.startsWith('/mock-subscription/') ||
    pathname.startsWith('/mock-voucher/')
  ) {
    return NextResponse.next();
  }

  // PWA assets — manifest, service worker, icons, offline fallback page.
  // Tyto musí být dostupné bez locale prefix (browser/PWA spec).
  if (
    pathname === '/manifest.json' ||
    pathname === '/sw.js' ||
    pathname === '/offline' ||
    /^\/icon-\d+\.png$/.test(pathname)
  ) {
    return NextResponse.next();
  }

  // Locale handling for the rest of the frontend
  const currentLocale = getPathnameLocale(pathname);

  if (!currentLocale) {
    const cookieLocale = request.cookies.get(LOCALE_COOKIE)?.value ?? null;
    const acceptLanguage = request.headers.get('accept-language');
    const locale = detectLocale(acceptLanguage, cookieLocale);

    const url = request.nextUrl.clone();
    url.pathname = `/${locale}${pathname}`;

    const response = NextResponse.redirect(url);
    response.cookies.set(LOCALE_COOKIE, locale, {
      maxAge: 60 * 60 * 24 * 365,
      sameSite: 'lax',
      httpOnly: false,
    });
    return response;
  }

  const pathWithoutLocale = pathnameWithoutLocale(pathname);
  const accessToken = request.cookies.get('accessToken')?.value;

  // Auth-only pages (login/register) když už přihlášený → veřejný marketplace.
  // Admin přejde do /platform manuálně přes nav link, ne magic redirectem z login URL.
  if (FRONTEND_AUTH_ONLY.some((r) => pathWithoutLocale.startsWith(r)) && accessToken) {
    return NextResponse.redirect(new URL(`/${currentLocale}/events`, request.url));
  }

  const response = NextResponse.next();
  response.headers.set('x-locale', currentLocale);
  return response;
}

export const config = {
  matcher: [
    // Exclude Next.js internals + static assets v /public co se servují přímo.
    // embed.js, sw.js a manifest.json MUSÍ být accessible bez locale prefix
    // (3rd party embeds + service worker registrations).
    '/((?!_next/static|_next/image|favicon\\.ico|robots\\.txt|sitemap\\.xml|embed\\.js|sw\\.js|manifest\\.json|icons/).*)',
  ],
};
