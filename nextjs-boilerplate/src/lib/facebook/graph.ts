/**
 * Mock Facebook Graph API SDK.
 *
 * Mock mód (default): pokud `FACEBOOK_APP_ID` v env není nastavený, všechny
 * volání vrací deterministic fake responses. To umožňuje plnou implementaci
 * UI/API/E2E bez Meta App approval (typicky ~2-4 týdny review).
 *
 * Production mód: nastavit env FACEBOOK_APP_ID + FACEBOOK_APP_SECRET +
 * FACEBOOK_REDIRECT_URI a SDK přepne na real fetch na graph.facebook.com.
 *
 * Reference:
 *   - OAuth: https://developers.facebook.com/docs/facebook-login/web
 *   - Page tokens: https://developers.facebook.com/docs/pages/access-tokens
 *   - Event API: https://developers.facebook.com/docs/graph-api/reference/event/
 *
 * Note: Facebook Event API byla v 2020 částečně omezena (jen Pages mohou
 * vytvářet events, ne osobní profily, ne třetí strany bez approval).
 * Pro produkci je třeba přidat App Review.
 */

import { randomBytes } from 'crypto';

const GRAPH_API_VERSION = 'v18.0';
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

export function isMockMode(): boolean {
  return !process.env.FACEBOOK_APP_ID;
}

function mockId(prefix: string): string {
  return `${prefix}-${randomBytes(8).toString('hex')}`;
}

// ============================================================
// OAuth flow
// ============================================================

export interface OauthUrlInput {
  redirectUri: string;
  state: string;
  scopes?: string[];
}

export function buildOauthUrl(input: OauthUrlInput): string {
  if (isMockMode()) {
    // V mock módu redirectneme na vlastní mock callback s instant code
    const params = new URLSearchParams({
      code: `mock-code-${randomBytes(8).toString('hex')}`,
      state: input.state,
    });
    return `${input.redirectUri}?${params.toString()}`;
  }
  const appId = process.env.FACEBOOK_APP_ID!;
  const params = new URLSearchParams({
    client_id: appId,
    redirect_uri: input.redirectUri,
    state: input.state,
    scope: (input.scopes ?? ['pages_show_list', 'pages_manage_posts', 'pages_manage_events']).join(','),
    response_type: 'code',
  });
  return `https://www.facebook.com/${GRAPH_API_VERSION}/dialog/oauth?${params.toString()}`;
}

export interface ExchangeCodeInput {
  code: string;
  redirectUri: string;
}

export interface UserAccessTokenResult {
  accessToken: string;
  expiresInSec: number;
  isMock: boolean;
}

export async function exchangeCodeForToken(
  input: ExchangeCodeInput,
): Promise<UserAccessTokenResult> {
  if (isMockMode()) {
    return {
      accessToken: `mock-user-token-${randomBytes(16).toString('hex')}`,
      expiresInSec: 60 * 60 * 24 * 60, // 60 days
      isMock: true,
    };
  }
  const url = new URL(`${GRAPH_BASE}/oauth/access_token`);
  url.searchParams.set('client_id', process.env.FACEBOOK_APP_ID!);
  url.searchParams.set('client_secret', process.env.FACEBOOK_APP_SECRET!);
  url.searchParams.set('redirect_uri', input.redirectUri);
  url.searchParams.set('code', input.code);
  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`FB OAuth exchange failed: ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as {
    access_token: string;
    expires_in?: number;
  };
  return {
    accessToken: body.access_token,
    expiresInSec: body.expires_in ?? 5183944, // ~60 days default
    isMock: false,
  };
}

// ============================================================
// Pages list (user → owned pages)
// ============================================================

export interface FbPage {
  id: string;
  name: string;
  category: string;
  accessToken: string;
  pictureUrl: string | null;
  isMock: boolean;
}

export async function listUserPages(userAccessToken: string): Promise<FbPage[]> {
  if (isMockMode()) {
    // Mock: vrátíme 2 fake pages aby UI mohlo testovat výběr.
    return [
      {
        id: mockId('page'),
        name: 'Můj klub (mock)',
        category: 'Music Venue',
        accessToken: `mock-page-token-${randomBytes(16).toString('hex')}`,
        pictureUrl: null,
        isMock: true,
      },
      {
        id: mockId('page'),
        name: 'Festival Promo (mock)',
        category: 'Event Organizer',
        accessToken: `mock-page-token-${randomBytes(16).toString('hex')}`,
        pictureUrl: null,
        isMock: true,
      },
    ];
  }
  const url = new URL(`${GRAPH_BASE}/me/accounts`);
  url.searchParams.set('fields', 'id,name,category,access_token,picture');
  url.searchParams.set('access_token', userAccessToken);
  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`FB listUserPages failed: ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as {
    data: Array<{
      id: string;
      name: string;
      category: string;
      access_token: string;
      picture?: { data: { url: string } };
    }>;
  };
  return body.data.map((p) => ({
    id: p.id,
    name: p.name,
    category: p.category,
    accessToken: p.access_token,
    pictureUrl: p.picture?.data.url ?? null,
    isMock: false,
  }));
}

// ============================================================
// Create FB Event on Page
// ============================================================

export interface CreateEventInput {
  pageId: string;
  pageAccessToken: string;
  name: string;
  description: string;
  startTime: string;          // ISO 8601
  endTime?: string;
  venueName?: string;
  cityName?: string;
  ticketUrl: string;
  coverPictureUrl?: string;
}

export interface CreateEventResult {
  fbEventId: string;
  permalinkUrl: string;
  isMock: boolean;
}

export async function createPageEvent(
  input: CreateEventInput,
): Promise<CreateEventResult> {
  if (isMockMode()) {
    const fbEventId = mockId('event');
    return {
      fbEventId,
      permalinkUrl: `https://facebook.com/events/${fbEventId}`,
      isMock: true,
    };
  }
  const url = new URL(`${GRAPH_BASE}/${input.pageId}/events`);
  const body = {
    name: input.name,
    description: input.description,
    start_time: input.startTime,
    end_time: input.endTime,
    ticket_uri: input.ticketUrl,
    place: input.venueName
      ? { name: input.venueName, location: { city: input.cityName ?? '' } }
      : undefined,
    cover: input.coverPictureUrl ? { source: input.coverPictureUrl } : undefined,
  };
  const res = await fetch(url.toString(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${input.pageAccessToken}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`FB createPageEvent failed: ${res.status} ${await res.text()}`);
  }
  const responseBody = (await res.json()) as { id: string };
  return {
    fbEventId: responseBody.id,
    permalinkUrl: `https://facebook.com/events/${responseBody.id}`,
    isMock: false,
  };
}
