import { NextResponse } from 'next/server';

export async function POST(): Promise<Response> {
  const res = NextResponse.json({ ok: true });
  res.cookies.set('accessToken', '', { maxAge: 0, path: '/' });
  res.cookies.set('refreshToken', '', { maxAge: 0, path: '/' });
  return res;
}
