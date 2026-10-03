import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from '@/lib/auth';
import { isAccessTokenPayload } from '@/lib/security/token-type';

/**
 * GET /api/auth/me — vrátí REÁLNÝ stav přihlášení z accessToken cookie.
 * Nahrazuje čtení z localStorage v TopNav (které šlo do nesouladu s realitou).
 * Bez DB — vše potřebné (name, email, roles) je v access tokenu.
 *
 * { user: null } pokud není platný accessToken (odhlášený / vypršelý).
 */
export async function GET(request: NextRequest): Promise<Response> {
  const accessToken = request.cookies.get('accessToken')?.value;
  if (!accessToken) {
    return NextResponse.json({ user: null }, { status: 200 });
  }
  let payload: Record<string, unknown>;
  try {
    payload = await verifyToken(accessToken);
  } catch {
    return NextResponse.json({ user: null }, { status: 200 });
  }
  // FIX K4d: jen access token (refresh token podstrčený do accessToken cookie neplatí).
  if (typeof payload.sub !== 'string' || !isAccessTokenPayload(payload)) {
    return NextResponse.json({ user: null }, { status: 200 });
  }
  return NextResponse.json({
    user: {
      id: payload.sub,
      email: typeof payload.email === 'string' ? payload.email : '',
      name: typeof payload.name === 'string' ? payload.name : '',
    },
    roles: payload.roles ?? { isPlatformAdmin: false, promoterMemberships: [] },
  });
}
