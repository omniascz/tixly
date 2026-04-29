import { NextRequest, NextResponse } from 'next/server';
import { trackClick } from '../../../services/affiliate.service';
import { AffiliateLinkNotFoundError } from '../../../types/affiliate.types';
import { AFFILIATE_COOKIE, AFFILIATE_COOKIE_TTL_DAYS } from '../../../types/affiliate.types';

const deps = { db: null as any, kafka: { send: async () => {} } };

// GET /r/[code] — affiliate redirect endpoint
// 1. Zaznamená klik
// 2. Nastaví cookie tixly_aff=code (30 dní)
// 3. Přesměruje na event stránku
export async function GET(
  request: NextRequest,
  { params }: { params: { code: string } },
) {
  const sessionId = request.cookies.get('session_id')?.value
    ?? request.headers.get('x-forwarded-for')
    ?? 'anonymous';
  const referrer = request.headers.get('referer');

  try {
    const { redirectUrl, cookieTtlDays } = await trackClick(
      deps,
      params.code,
      sessionId,
      referrer,
    );

    const response = NextResponse.redirect(redirectUrl, { status: 302 });
    response.cookies.set(AFFILIATE_COOKIE, params.code, {
      httpOnly: false,          // JS musí číst cookie při checkoutu
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: cookieTtlDays * 24 * 60 * 60,
      path: '/',
    });
    return response;
  } catch (err) {
    if (err instanceof AffiliateLinkNotFoundError) {
      // Neplatný kód → redirect na homepage bez cookie
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://tixly.cz';
      return NextResponse.redirect(baseUrl, { status: 302 });
    }
    throw err;
  }
}
