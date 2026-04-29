import { NextRequest, NextResponse } from 'next/server';
import {
  db,
  signAccessToken,
  verifyToken,
  getUserRoles,
  setAuthCookies,
  signRefreshToken,
} from '@/lib/auth';

interface UserRow {
  id: string;
  email: string;
  name: string;
}

export async function POST(request: NextRequest): Promise<Response> {
  const refreshToken = request.cookies.get('refreshToken')?.value;
  if (!refreshToken) {
    return NextResponse.json({ error: 'No refresh token' }, { status: 401 });
  }

  let payload;
  try {
    payload = await verifyToken(refreshToken);
  } catch {
    return NextResponse.json({ error: 'Invalid refresh token' }, { status: 401 });
  }

  if (payload['type'] !== 'refresh' || !payload.sub) {
    return NextResponse.json({ error: 'Invalid token type' }, { status: 401 });
  }

  const result = await db().query<UserRow>(
    'SELECT id, email, name FROM identity.users WHERE id = $1 LIMIT 1',
    [payload.sub],
  );
  if (result.rows.length === 0) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  const user = result.rows[0]!;
  const roles = await getUserRoles(user.id);
  const accessToken = await signAccessToken(user, roles);
  const newRefresh = await signRefreshToken(user);

  const res = NextResponse.json({ user, roles, accessToken });
  setAuthCookies(res, accessToken, newRefresh);
  return res;
}
