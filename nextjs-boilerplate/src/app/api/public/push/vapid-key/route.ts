/**
 * GET /api/public/push/vapid-key — vrátí VAPID public key pro buyer subscribe.
 *
 * Mock režim (žádné VAPID_PUBLIC_KEY env) → vrátí { configured: false }.
 * Client komponenta v tom případě skryje opt-in tlačítko.
 *
 * Web Push spec: RFC 8292 (VAPID).
 */
import { NextResponse } from 'next/server';

export async function GET(): Promise<Response> {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  if (!publicKey) {
    return NextResponse.json(
      { configured: false },
      { headers: { 'Cache-Control': 'public, max-age=60' } },
    );
  }
  return NextResponse.json(
    {
      configured: true,
      publicKey,
    },
    { headers: { 'Cache-Control': 'public, max-age=3600' } },
  );
}
