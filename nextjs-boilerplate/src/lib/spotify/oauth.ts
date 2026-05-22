/**
 * Spotify OAuth Authorization Code Flow + PKCE (RFC 7636).
 *
 * Production flow:
 *   1. POST /api/buyer/spotify/connect → generate code_verifier (random 64+
 *      chars), code_challenge = base64url(sha256(verifier)), state (CSRF),
 *      store v marketing.user_spotify_connections.access_token_enc jako
 *      JSON {state, verifier, userId}. Return Spotify authorize URL.
 *   2. Buyer redirect → Spotify login → user granted scopes → Spotify
 *      redirect zpět na /api/buyer/spotify/callback?code=&state=.
 *   3. Callback: validate state, exchange code → access_token + refresh_token.
 *      Re-fetch top artists, store.
 *   4. Periodic refresh: cron `/api/internal/cron/refresh-spotify` 50min.
 *
 * Mock fallback: pokud SPOTIFY_CLIENT_ID env chybí, mock POST endpoint
 * pokračuje s default seedem (zachováno).
 */

import { createHash, randomBytes } from 'crypto';

export interface PkcePair {
  verifier: string;
  challenge: string;
  state: string;
}

export function generatePkce(): PkcePair {
  const verifier = base64UrlEncode(randomBytes(48));
  const challenge = base64UrlEncode(createHash('sha256').update(verifier).digest());
  const state = base64UrlEncode(randomBytes(24));
  return { verifier, challenge, state };
}

function base64UrlEncode(buf: Buffer): string {
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export interface SpotifyConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export function getSpotifyConfig(): SpotifyConfig | null {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  const redirectUri =
    process.env.SPOTIFY_REDIRECT_URI ??
    `${process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'}/api/buyer/spotify/callback`;
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret, redirectUri };
}

const SPOTIFY_SCOPES = ['user-top-read', 'user-read-email'].join(' ');

export function buildAuthorizeUrl(
  cfg: SpotifyConfig,
  pkce: PkcePair,
): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: cfg.clientId,
    scope: SPOTIFY_SCOPES,
    redirect_uri: cfg.redirectUri,
    state: pkce.state,
    code_challenge_method: 'S256',
    code_challenge: pkce.challenge,
  });
  return `https://accounts.spotify.com/authorize?${params.toString()}`;
}

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope: string;
  token_type: 'Bearer';
}

export async function exchangeCodeForTokens(
  cfg: SpotifyConfig,
  code: string,
  verifier: string,
): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: cfg.redirectUri,
    client_id: cfg.clientId,
    code_verifier: verifier,
  });
  const r = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString('base64')}`,
    },
    body: body.toString(),
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`Spotify token exchange failed: ${r.status} ${text}`);
  }
  return (await r.json()) as TokenResponse;
}

export async function refreshAccessToken(
  cfg: SpotifyConfig,
  refreshToken: string,
): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: cfg.clientId,
  });
  const r = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString('base64')}`,
    },
    body: body.toString(),
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`Spotify token refresh failed: ${r.status} ${text}`);
  }
  // Spotify může vrátit jen access_token, refresh_token zachovat existing
  const data = (await r.json()) as Omit<TokenResponse, 'refresh_token'> & {
    refresh_token?: string;
  };
  return {
    ...data,
    refresh_token: data.refresh_token ?? refreshToken,
  };
}

export interface SpotifyTopArtist {
  id: string;
  name: string;
  genres: string[];
}

export async function fetchTopArtists(
  accessToken: string,
  limit = 20,
): Promise<SpotifyTopArtist[]> {
  const r = await fetch(
    `https://api.spotify.com/v1/me/top/artists?limit=${limit}&time_range=medium_term`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`Spotify top artists failed: ${r.status} ${text}`);
  }
  const data = (await r.json()) as {
    items: Array<{ id: string; name: string; genres: string[] }>;
  };
  return data.items.map((a) => ({ id: a.id, name: a.name, genres: a.genres ?? [] }));
}

export async function fetchMe(
  accessToken: string,
): Promise<{ id: string; display_name: string | null }> {
  const r = await fetch('https://api.spotify.com/v1/me', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!r.ok) {
    throw new Error(`Spotify /me failed: ${r.status}`);
  }
  const data = (await r.json()) as { id: string; display_name?: string };
  return { id: data.id, display_name: data.display_name ?? null };
}
