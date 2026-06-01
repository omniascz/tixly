/**
 * GET /api/buyer/spotify/callback?code=&state= — Spotify OAuth redirect target
 *
 * Flow:
 *   1. Validate state → pull marketing.spotify_oauth_pending row (verifier + user_id)
 *   2. Pokud row expired/nenalezen → redirect /cs/discover?error=oauth_expired
 *   3. POST Spotify /api/token (code + verifier) → access_token + refresh_token
 *   4. GET Spotify /me → spotify_user_id + display_name
 *   5. GET Spotify /me/top/artists → top 20
 *   6. UPSERT marketing.user_spotify_connections (is_mock=false, tokens
 *      base64 stored — production mělo by být encrypted, pro MVP plain)
 *   7. Wipe + seed user_top_artists
 *   8. Cleanup pending row
 *   9. Redirect /cs/discover?connected=1
 */
import { NextRequest, NextResponse } from 'next/server';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';
import {
  exchangeCodeForTokens,
  fetchMe,
  fetchTopArtists,
  getSpotifyConfig,
} from '@/lib/spotify/oauth';


function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
}

function errorRedirect(reason: string): Response {
  const url = new URL('/cs/discover', appUrl());
  url.searchParams.set('error', reason);
  return NextResponse.redirect(url, 303);
}

export async function GET(req: NextRequest): Promise<Response> {
  return runWithServiceContext(async () => {

  const code = req.nextUrl.searchParams.get('code');
  const state = req.nextUrl.searchParams.get('state');
  const oauthError = req.nextUrl.searchParams.get('error');

  if (oauthError) return errorRedirect(oauthError);
  if (!code || !state) return errorRedirect('missing_code_or_state');

  const cfg = getSpotifyConfig();
  if (!cfg) return errorRedirect('config_missing');

  const client = await db().connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL app.is_platform_admin = 'true'`);

    const pending = await client.query<{ user_id: string; code_verifier: string }>(
      `SELECT user_id, code_verifier FROM marketing.spotify_oauth_pending
        WHERE state = $1 AND expires_at > NOW()
        FOR UPDATE`,
      [state],
    );
    if (pending.rows.length === 0) {
      await client.query('ROLLBACK');
      return errorRedirect('state_invalid_or_expired');
    }
    const { user_id, code_verifier } = pending.rows[0];

    let tokens;
    try {
      tokens = await exchangeCodeForTokens(cfg, code, code_verifier);
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('[spotify callback] token exchange', err);
      return errorRedirect('token_exchange_failed');
    }

    let me;
    let topArtists;
    try {
      [me, topArtists] = await Promise.all([
        fetchMe(tokens.access_token),
        fetchTopArtists(tokens.access_token, 20),
      ]);
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('[spotify callback] api fetch', err);
      return errorRedirect('api_fetch_failed');
    }

    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);

    await client.query(
      `INSERT INTO marketing.user_spotify_connections
         (user_id, spotify_user_id, spotify_display_name, access_token_enc,
          refresh_token_enc, scopes, expires_at, connected_at, last_sync_at, is_mock)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW(), false)
       ON CONFLICT (user_id) DO UPDATE
         SET spotify_user_id = EXCLUDED.spotify_user_id,
             spotify_display_name = EXCLUDED.spotify_display_name,
             access_token_enc = EXCLUDED.access_token_enc,
             refresh_token_enc = EXCLUDED.refresh_token_enc,
             scopes = EXCLUDED.scopes,
             expires_at = EXCLUDED.expires_at,
             last_sync_at = NOW(),
             is_mock = false`,
      [
        user_id,
        me.id,
        me.display_name,
        Buffer.from(tokens.access_token, 'utf8'),
        Buffer.from(tokens.refresh_token, 'utf8'),
        tokens.scope.split(' '),
        expiresAt.toISOString(),
      ],
    );

    await client.query(
      `DELETE FROM marketing.user_top_artists WHERE user_id = $1`,
      [user_id],
    );
    for (let i = 0; i < topArtists.length; i++) {
      const a = topArtists[i];
      await client.query(
        `INSERT INTO marketing.user_top_artists
           (user_id, artist_spotify_id, artist_name, genres, rank, synced_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         ON CONFLICT DO NOTHING`,
        [user_id, a.id, a.name, a.genres, i + 1],
      );
    }

    await client.query(
      `DELETE FROM marketing.spotify_oauth_pending WHERE state = $1`,
      [state],
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    console.error('[spotify callback]', err);
    return errorRedirect('internal');
  } finally {
    client.release();
  }

  const url = new URL('/cs/discover', appUrl());
  url.searchParams.set('connected', '1');
  return NextResponse.redirect(url, 303);

  });
}
