/**
 * GET /api/admin/facebook/oauth/callback?code=...&state=...
 *
 * Vyměnit code za access token, načíst seznam pages, uložit je pro promotéra.
 * State verify (HMAC) chrání proti CSRF.
 *
 * Po úspěchu redirect na /admin/facebook?connected=N (N = počet napojených pages).
 */

import { createHmac } from 'crypto';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';
import { NextRequest, NextResponse } from 'next/server';
import { requirePromoter } from '@/lib/admin-auth';
import { encryptSecret } from '@/lib/crypto';
import { safeEqualStr } from '@/lib/security/compare';
import { fbStateSecret } from '../state-secret';
import {
  exchangeCodeForToken,
  isMockMode,
  listUserPages,
} from '@/lib/facebook/graph';

export const dynamic = 'force-dynamic';


function verifyState(state: string): string | null {
  const parts = state.split('.');
  if (parts.length !== 3) return null;
  const [userId, nonce, sig] = parts;
  const expected = createHmac('sha256', fbStateSecret())
    .update(`${userId}.${nonce}`)
    .digest('hex');
  if (!safeEqualStr(sig, expected)) return null;
  return userId;
}

export async function GET(req: NextRequest): Promise<Response> {
  return runWithServiceContext(async () => {

  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

  if (error) {
    return NextResponse.redirect(
      `${appUrl}/admin/facebook?error=${encodeURIComponent(error)}`,
      302,
    );
  }
  if (!code || !state) {
    return NextResponse.json({ error: 'Missing code/state' }, { status: 422 });
  }
  const verifiedUserId = verifyState(state);
  if (!verifiedUserId) {
    return NextResponse.json({ error: 'Invalid state (CSRF)' }, { status: 401 });
  }

  // Ověření promotér membership přes header (middleware) NEBO přes state-encoded user.
  // V mock módu volání může jít přímo (žádný redirect FB), takže fallbackneme na state.
  const promoter = await requirePromoter(req);
  let promoterId: string;
  let userId: string;
  if (promoter && promoter.status === 'active') {
    promoterId = promoter.promoterId;
    userId = promoter.userId;
  } else {
    // V mock módu může být JWT v cookies (callback je redirect z FB), fallback na DB lookup.
    const r = await db().query<{ promoter_id: string }>(
      `SELECT promoter_id FROM platform.promoter_members
       WHERE user_id = $1 AND status = 'active' LIMIT 1`,
      [verifiedUserId],
    );
    if (r.rows.length === 0) {
      return NextResponse.redirect(
        `${appUrl}/admin/facebook?error=no_promoter_membership`,
        302,
      );
    }
    promoterId = r.rows[0].promoter_id;
    userId = verifiedUserId;
  }

  try {
    const redirectUri = `${appUrl}/api/admin/facebook/oauth/callback`;
    const { accessToken } = await exchangeCodeForToken({ code, redirectUri });
    const pages = await listUserPages(accessToken);

    if (pages.length === 0) {
      return NextResponse.redirect(`${appUrl}/admin/facebook?connected=0`, 302);
    }

    // Uložit nebo update všechny pages
    const mock = isMockMode();
    for (const page of pages) {
      const encryptedToken = Buffer.from(encryptSecret(page.accessToken), 'base64');
      await db().query(
        `INSERT INTO marketing.facebook_pages
           (promoter_id, fb_page_id, page_name, page_category, page_picture_url,
            access_token_encrypted, connected_by_user_id, is_mock)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (promoter_id, fb_page_id) DO UPDATE
           SET page_name = EXCLUDED.page_name,
               page_category = EXCLUDED.page_category,
               page_picture_url = EXCLUDED.page_picture_url,
               access_token_encrypted = EXCLUDED.access_token_encrypted,
               disconnected_at = NULL,
               connected_at = now()`,
        [
          promoterId,
          page.id,
          page.name,
          page.category,
          page.pictureUrl,
          encryptedToken,
          userId,
          mock,
        ],
      );
    }

    return NextResponse.redirect(
      `${appUrl}/admin/facebook?connected=${pages.length}${mock ? '&mock=1' : ''}`,
      302,
    );
  } catch (err) {
    // Detail jen do server logu — do redirect URL (klient) jen generický kód,
    // ať neuniká interní chyba / token-exchange detail.
    console.error('[FB OAuth callback]', err);
    return NextResponse.redirect(
      `${appUrl}/admin/facebook?error=connect_failed`,
      302,
    );
  }

  });
}
