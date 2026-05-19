/**
 * GET /api/orders — public-ish list endpoint (vyžaduje auth).
 *
 * V smoke-03 test ověřuje že vrací 401 bez auth (`x-user-id: ''`).
 * Tento endpoint je pro buyer JWT auth (ne B2B Bearer) — používá se
 * z buyer mobile app / SPA s session cookie.
 */
import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest): Promise<Response> {
  const userId = req.headers.get('x-user-id')?.trim();
  const authHeader = req.headers.get('authorization')?.trim();
  if (!userId && !authHeader) {
    return NextResponse.json(
      { error: 'UNAUTHORIZED', message: 'x-user-id header or Bearer token required' },
      { status: 401 },
    );
  }
  // Stub — full impl returns user's orders. Pro M1 launch je `/api/buyer/my-tickets` autoritativní.
  return NextResponse.json({
    orders: [],
    note: 'See /api/buyer/my-tickets for authoritative buyer orders endpoint',
  });
}
