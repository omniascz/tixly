/**
 * @tixly/sdk — TypeScript client for Tixly REST API
 *
 * Usage:
 *   const client = new TixlyClient({ apiKey: 'tick_live_...', baseUrl: 'https://app.tixly.cz' });
 *   const { events } = await client.events.list({ city: 'Praha', limit: 20 });
 *
 * This file is the single entry point — publishable as npm package @tixly/sdk.
 * Works in Node.js 18+, Deno, Bun, browser.
 */

export class TixlyError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'TixlyError';
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TixlyEvent {
  id: string;
  title: string;
  slug: string | null;
  description: string | null;
  category: string | null;
  startsAt: string;
  endsAt: string | null;
  venue: { name: string | null; city: string | null };
  coverImageUrl: string | null;
  price: { min: number | null; max: number | null; currency: string };
  promoter: { id: string; name: string | null };
  availableCapacity: number | null;
  ticketUrl: string;
}

export interface EventsListParams {
  category?: string;
  city?: string;
  promoterId?: string;
  dateFrom?: string;
  dateTo?: string;
  minPrice?: number;
  maxPrice?: number;
  q?: string;
  sort?: 'date_asc' | 'date_desc' | 'price_asc' | 'price_desc' | 'relevance';
  limit?: number;
  offset?: number;
}

export interface EventsListResult {
  events: TixlyEvent[];
  total: number;
  limit: number;
  offset: number;
  _links: { self: string; next?: string; prev?: string };
}

export interface TicketClass {
  id: string;
  name: string;
  description: string | null;
  price: number;
  currency: string;
  status: string;
  remaining: number | null;
  maxPerOrder: number | null;
}

export interface InventoryStatus {
  eventId: string;
  totalCapacity: number | null;
  remainingCapacity: number | null;
  ticketClasses: { id: string; name: string; remaining: number | null }[];
}

export interface WebhookConfig {
  url: string;
  event_types: string[];
}

export interface Webhook {
  id: string;
  url: string;
  event_types: string[];
  status: 'active' | 'inactive';
  createdAt: string;
}

// ─── Resource classes ─────────────────────────────────────────────────────────

class EventsResource {
  constructor(private readonly client: TixlyClient) {}

  async list(params: EventsListParams = {}): Promise<EventsListResult> {
    const sp = new URLSearchParams();
    if (params.category)   sp.set('category', params.category);
    if (params.city)       sp.set('city', params.city);
    if (params.promoterId) sp.set('promoter_id', params.promoterId);
    if (params.dateFrom)   sp.set('date_from', params.dateFrom);
    if (params.dateTo)     sp.set('date_to', params.dateTo);
    if (params.minPrice != null) sp.set('min_price', String(params.minPrice));
    if (params.maxPrice != null) sp.set('max_price', String(params.maxPrice));
    if (params.q)          sp.set('q', params.q);
    if (params.sort)       sp.set('sort', params.sort);
    if (params.limit != null)  sp.set('limit', String(params.limit));
    if (params.offset != null) sp.set('offset', String(params.offset));

    return this.client.request<EventsListResult>(`/api/public/events?${sp.toString()}`);
  }

  async get(id: string, expand: string[] = []): Promise<TixlyEvent & { ticketClasses?: TicketClass[] }> {
    const ep = expand.length ? `?expand=${expand.join(',')}` : '';
    return this.client.request<TixlyEvent & { ticketClasses?: TicketClass[] }>(
      `/api/v3/events/${encodeURIComponent(id)}${ep}`,
      { auth: 'bearer' },
    );
  }

  async ticketClasses(eventId: string): Promise<{ ticket_classes: TicketClass[] }> {
    return this.client.request<{ ticket_classes: TicketClass[] }>(
      `/api/v3/events/${encodeURIComponent(eventId)}/ticket_classes`,
      { auth: 'bearer' },
    );
  }
}

class InventoryResource {
  constructor(private readonly client: TixlyClient) {}

  async status(params: { eventId?: string; promoterId?: string }): Promise<{ items: InventoryStatus[] }> {
    const sp = new URLSearchParams();
    if (params.eventId)   sp.set('eventId', params.eventId);
    if (params.promoterId) sp.set('promoterId', params.promoterId);
    return this.client.request<{ items: InventoryStatus[] }>(
      `/api/v3/inventory/status?${sp.toString()}`,
      { auth: 'bearer' },
    );
  }
}

class WebhooksResource {
  constructor(private readonly client: TixlyClient) {}

  async list(): Promise<{ webhooks: Webhook[] }> {
    return this.client.request<{ webhooks: Webhook[] }>('/api/v3/webhooks', { auth: 'bearer' });
  }

  async create(config: WebhookConfig): Promise<{ webhook_id: string; signing_secret: string }> {
    return this.client.request<{ webhook_id: string; signing_secret: string }>(
      '/api/v3/webhooks',
      { method: 'POST', body: config, auth: 'bearer' },
    );
  }

  async delete(webhookId: string): Promise<void> {
    await this.client.request<void>(`/api/v3/webhooks/${encodeURIComponent(webhookId)}`, {
      method: 'DELETE', auth: 'bearer',
    });
  }
}

class FeedResource {
  constructor(private readonly client: TixlyClient) {}

  eventsUrl(params: { promoterId?: string; category?: string; city?: string } = {}): string {
    const sp = new URLSearchParams();
    if (params.promoterId) sp.set('promoterId', params.promoterId);
    if (params.category)  sp.set('category', params.category);
    if (params.city)      sp.set('city', params.city);
    const q = sp.toString();
    return `${this.client.baseUrl}/api/v1/feed/events${q ? '?' + q : ''}`;
  }

  icsUrl(params: { promoterId?: string } = {}): string {
    const sp = new URLSearchParams();
    if (params.promoterId) sp.set('promoterId', params.promoterId);
    const q = sp.toString();
    return `${this.client.baseUrl}/api/v1/feed/events.ics${q ? '?' + q : ''}`;
  }

  rssUrl(params: { promoterId?: string } = {}): string {
    const sp = new URLSearchParams();
    if (params.promoterId) sp.set('promoterId', params.promoterId);
    const q = sp.toString();
    return `${this.client.baseUrl}/api/v1/feed/events.rss${q ? '?' + q : ''}`;
  }
}

// ─── Main client ──────────────────────────────────────────────────────────────

export interface TixlyClientConfig {
  apiKey: string;
  baseUrl?: string;
  timeout?: number;
}

export class TixlyClient {
  readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeout: number;

  readonly events:    EventsResource;
  readonly inventory: InventoryResource;
  readonly webhooks:  WebhooksResource;
  readonly feed:      FeedResource;

  constructor(config: TixlyClientConfig) {
    this.apiKey  = config.apiKey;
    this.baseUrl = (config.baseUrl ?? 'https://app.tixly.cz').replace(/\/$/, '');
    this.timeout = config.timeout ?? 30_000;

    this.events    = new EventsResource(this);
    this.inventory = new InventoryResource(this);
    this.webhooks  = new WebhooksResource(this);
    this.feed      = new FeedResource(this);
  }

  async request<T>(
    path: string,
    opts: { method?: string; body?: unknown; auth?: 'bearer' | 'none' } = {},
  ): Promise<T> {
    const url = path.startsWith('http') ? path : `${this.baseUrl}${path}`;
    const method = opts.method ?? 'GET';
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (opts.auth !== 'none') headers['Authorization'] = `Bearer ${this.apiKey}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers,
        body: opts.body != null ? JSON.stringify(opts.body) : undefined,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      let code = 'API_ERROR';
      try {
        const e = await res.json() as { error?: string; code?: string };
        code = e.error ?? e.code ?? code;
      } catch { /* ignore */ }
      throw new TixlyError(res.status, code, `Tixly API error ${res.status}: ${code}`);
    }

    if (res.status === 204) return undefined as T;
    return res.json() as Promise<T>;
  }
}

// ─── Webhook verification helper ──────────────────────────────────────────────

export async function verifyWebhookSignature(
  rawBody: Uint8Array | string,
  signature: string,
  secret: string,
): Promise<boolean> {
  const enc = new TextEncoder();
  const keyData = enc.encode(secret);
  const bodyBuf: ArrayBuffer = typeof rawBody === 'string'
    ? enc.encode(rawBody).buffer as ArrayBuffer
    : (rawBody.buffer instanceof ArrayBuffer ? rawBody.buffer : (rawBody.buffer as SharedArrayBuffer).slice(0)) as ArrayBuffer;

  const key = await crypto.subtle.importKey('raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, bodyBuf);
  const hex = Array.from(new Uint8Array(mac)).map((b) => b.toString(16).padStart(2, '0')).join('');
  const expected = `sha256=${hex}`;

  // Constant-time compare
  if (signature.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return diff === 0;
}
