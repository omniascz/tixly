/**
 * GET /api/admin/facebook/oauth/start
 *
 * Redirect promotéra na FB OAuth dialog. State je signed user_id (CSRF
 * protection — callback ho verifikuje).
 *
 * V mock módu redirect rovnou na callback s fake code.
 */

import { createHmac, randomBytes } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { buildOauthUrl, isMockMode } from '@/lib/facebook/graph';
import { fbStateSecret } from '../state-secret';

export const dynamic = 'force-dynamic';

function signState(userId: string, nonce: string): string {
  const payload = `${userId}.${nonce}`;
  // Plný HMAC-SHA256 (ne 64bit oříznutý) — 16 hex znaků = jen 64 bitů, forge-able.
  const sig = createHmac('sha256', fbStateSecret()).update(payload).digest('hex');
  return `${payload}.${sig}`;
}

export async function GET(req: NextRequest): Promise<Response> {
  const userId = req.headers.get('x-user-id');
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const nonce = randomBytes(8).toString('hex');
  const state = signState(userId, nonce);

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  const redirectUri = `${appUrl}/api/admin/facebook/oauth/callback`;
  const oauthUrl = buildOauthUrl({
    redirectUri,
    state,
    scopes: ['pages_show_list', 'pages_manage_posts', 'pages_manage_events'],
  });

  return NextResponse.json({
    redirectUrl: oauthUrl,
    isMock: isMockMode(),
    state,
  });
}
