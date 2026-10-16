import type { JSX } from 'react';
import { Code, Key, Webhook, Globe, ArrowRight, Terminal, BookOpen, Users } from 'lucide-react';
import Link from 'next/link';


export const metadata = { title: 'Tixly Developer Portal', description: 'Build with Tixly API — events, tickets, webhooks, OAuth 2.0' };

const ENDPOINTS = [
  { method: 'GET',   path: '/api/public/events',              desc: 'Discovery — search events by city, date, price, category', auth: 'none' },
  { method: 'GET',   path: '/api/v1/feed/events',             desc: 'Bulk export JSON/CSV for affiliates (1h cache)',            auth: 'none' },
  { method: 'GET',   path: '/api/v1/feed/events.ics',         desc: 'iCalendar feed (Google/Outlook/Apple Calendar)',            auth: 'none' },
  { method: 'GET',   path: '/api/v1/feed/events.rss',         desc: 'RSS 2.0 feed for aggregators',                             auth: 'none' },
  { method: 'GET',   path: '/api/v3/events/:id',              desc: 'Event detail with expansions (ticket_classes, venue)',      auth: 'oauth' },
  { method: 'GET',   path: '/api/v3/inventory/status',        desc: 'Real-time inventory snapshot (materialized, 1 min)',        auth: 'oauth' },
  { method: 'GET',   path: '/api/v3/organizations/:id/events','desc': 'Events by organization',                                  auth: 'oauth' },
  { method: 'GET',   path: '/api/v3/users/me',                desc: 'Authenticated user profile',                               auth: 'oauth' },
  { method: 'POST',  path: '/api/v3/webhooks',                desc: 'Register webhook endpoint',                                auth: 'oauth' },
  { method: 'GET',   path: '/api/v3/secure-entry/barcode',    desc: 'Rotating TOTP barcode (30s, SafeTix equivalent)',          auth: 'token' },
  { method: 'POST',  path: '/api/partner/sales',              desc: 'Partner POS sale (cash or card terminal)',                  auth: 'partner' },
] as const;

const WEBHOOK_EVENTS = [
  'order.created', 'order.paid', 'order.refunded',
  'event.published', 'event.cancelled', 'event.sold_out',
  'ticket.issued', 'ticket.checked_in', 'ticket.transferred',
  'payout.settled',
];

const SCOPES = [
  { name: 'read_events',     desc: 'Read events and ticket types' },
  { name: 'write_events',    desc: 'Create and update events' },
  { name: 'read_orders',     desc: 'Read orders and payments' },
  { name: 'write_orders',    desc: 'Create orders on behalf of user' },
  { name: 'read_attendees',  desc: 'Read attendee list' },
  { name: 'read_tickets',    desc: 'Read ticket details' },
  { name: 'manage_webhooks', desc: 'Register and manage webhook endpoints' },
];

const AUTH_BADGE: Record<string, string> = {
  none:    'bg-slate-100 text-slate-600',
  oauth:   'bg-blue-100 text-blue-700',
  partner: 'bg-purple-100 text-purple-700',
  token:   'bg-amber-100 text-amber-700',
};

export default function DeveloperPortalPage(): JSX.Element {
  return (
    <div className="min-h-screen bg-[#0a0f1a] text-white">
      {/* Nav */}
      <nav className="border-b border-white/10 px-6 py-4">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-xl font-bold tracking-tight">Tixly</span>
            <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs">Developer</span>
          </div>
          <div className="flex items-center gap-6 text-sm text-white/70">
            <a href="#endpoints" className="hover:text-white">API Reference</a>
            <a href="#auth" className="hover:text-white">Auth</a>
            <a href="#webhooks" className="hover:text-white">Webhooks</a>
            <a href="#sdk" className="hover:text-white">SDK</a>
            <Link href="/admin/oauth-apps" className="rounded-md bg-white px-4 py-1.5 text-sm font-semibold text-[#0a0f1a] hover:bg-white/90">
              Get API Key
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <div className="mx-auto max-w-6xl px-6 py-20">
        <div className="max-w-2xl">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/60">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400"></span>
            REST API v3 · OpenAPI 3.0 · OAuth 2.0 + PKCE
          </div>
          <h1 className="mb-4 text-5xl font-bold leading-tight tracking-tight">
            Build with<br />Tixly API
          </h1>
          <p className="mb-8 text-lg text-white/60">
            Full-stack ticketing API for CZ/SK market. Discovery feeds, real-time inventory,
            secure entry barcodes, webhooks, OAuth 2.0 — everything you need to integrate
            ticket sales into your product.
          </p>
          <div className="flex gap-3">
            <Link href="/admin/oauth-apps" className="flex items-center gap-2 rounded-lg bg-white px-5 py-2.5 text-sm font-semibold text-[#0a0f1a] hover:bg-white/90">
              Start building <ArrowRight className="h-4 w-4" />
            </Link>
            <a href="/openapi.yaml" className="flex items-center gap-2 rounded-lg border border-white/20 px-5 py-2.5 text-sm font-semibold hover:bg-white/5">
              <BookOpen className="h-4 w-4" /> OpenAPI spec
            </a>
          </div>
        </div>
      </div>

      {/* Cards */}
      <div className="mx-auto max-w-6xl px-6 pb-16">
        <div className="grid gap-4 sm:grid-cols-4">
          {[
            { icon: Globe, title: 'Discovery API', desc: 'Public event search with filtering, pagination, RSS, iCal — no auth needed.' },
            { icon: Key,   title: 'OAuth 2.0 + PKCE', desc: 'Standard auth flow. Scoped tokens. Refresh tokens. Client credentials.' },
            { icon: Webhook, title: 'Webhooks', desc: '10 event types. HMAC signing. Retry with delivery log.' },
            { icon: Code,  title: 'TypeScript SDK', desc: 'Typed client for Node.js. Install from npm: @tixly/sdk.' },
          ].map(({ icon: Icon, title, desc }) => (
            <div key={title} className="rounded-xl border border-white/10 bg-white/5 p-5">
              <Icon className="mb-3 h-5 w-5 text-white/50" />
              <p className="mb-1 font-semibold">{title}</p>
              <p className="text-sm text-white/50">{desc}</p>
            </div>
          ))}
        </div>

        {/* Quick start */}
        <div className="mt-16">
          <div className="flex items-center gap-2 mb-6">
            <Terminal className="h-4 w-4 text-white/40" />
            <h2 className="text-xl font-bold">Quick start</h2>
          </div>
          <div className="rounded-xl border border-white/10 bg-[#0d1424] p-6 font-mono text-sm">
            <p className="mb-2 text-white/40"># 1. Install the SDK</p>
            <p className="mb-6 text-emerald-400">npm install @tixly/sdk</p>
            <p className="mb-2 text-white/40"># 2. Search events</p>
            <pre className="text-white/80">{`import { TixlyClient } from '@tixly/sdk';

const client = new TixlyClient({
  apiKey: 'tick_live_...',   // from /admin/oauth-apps
  baseUrl: 'https://app.tixly.cz',
});

const { events } = await client.events.list({
  city: 'Praha',
  category: 'concert',
  dateFrom: '2026-09-01',
  limit: 20,
});`}</pre>
          </div>
        </div>

        {/* Endpoint reference */}
        <div className="mt-16" id="endpoints">
          <h2 className="mb-6 text-xl font-bold">API Reference</h2>
          <div className="overflow-hidden rounded-xl border border-white/10">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 bg-white/5">
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase text-white/40">Method</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase text-white/40">Endpoint</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase text-white/40">Description</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase text-white/40">Auth</th>
                </tr>
              </thead>
              <tbody>
                {ENDPOINTS.map((ep) => (
                  <tr key={ep.path} className="border-b border-white/5 hover:bg-white/3">
                    <td className="px-4 py-3">
                      <span className={`rounded px-1.5 py-0.5 text-xs font-bold ${ep.method === 'GET' ? 'bg-emerald-900/60 text-emerald-400' : 'bg-amber-900/60 text-amber-400'}`}>
                        {ep.method}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-white/70">{ep.path}</td>
                    <td className="px-4 py-3 text-white/50">{ep.desc}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs ${AUTH_BADGE[ep.auth]}`}>
                        {ep.auth}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Auth section */}
        <div className="mt-16" id="auth">
          <h2 className="mb-6 text-xl font-bold">Authentication</h2>
          <div className="grid gap-6 sm:grid-cols-2">
            <div className="rounded-xl border border-white/10 bg-white/5 p-6">
              <p className="mb-2 font-semibold">B2B API Keys</p>
              <p className="mb-4 text-sm text-white/50">Server-to-server. No user context. Prefix: <code className="text-white/80">tick_live_*</code> / <code className="text-white/80">tick_test_*</code></p>
              <pre className="rounded-lg bg-black/40 p-3 font-mono text-xs text-white/70">{`Authorization: Bearer tick_live_abc123...

Rate limit: 1,000 req/min per key
Headers: X-RateLimit-Limit, X-RateLimit-Remaining`}</pre>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/5 p-6">
              <p className="mb-2 font-semibold">OAuth 2.0 + PKCE</p>
              <p className="mb-4 text-sm text-white/50">For apps acting on behalf of users. Standard RFC 6749 flow with refresh tokens.</p>
              <pre className="rounded-lg bg-black/40 p-3 font-mono text-xs text-white/70">{`GET /api/oauth/authorize
  ?client_id=xxx
  &redirect_uri=https://...
  &scope=read_events read_orders
  &code_challenge=... (PKCE)

POST /api/oauth/token
  grant_type=authorization_code`}</pre>
            </div>
          </div>

          <div className="mt-6 rounded-xl border border-white/10 bg-white/5 p-6">
            <p className="mb-3 font-semibold">Available OAuth Scopes</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {SCOPES.map((s) => (
                <div key={s.name} className="flex items-start gap-3">
                  <code className="mt-0.5 rounded bg-black/40 px-2 py-0.5 text-xs text-blue-300">{s.name}</code>
                  <span className="text-sm text-white/50">{s.desc}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Webhooks */}
        <div className="mt-16" id="webhooks">
          <h2 className="mb-6 text-xl font-bold">Webhooks</h2>
          <p className="mb-4 text-white/50">Register an endpoint to receive real-time event notifications. Tixly signs each request with HMAC-SHA256 via the <code className="text-white/80">X-Tixly-Signature</code> header.</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {WEBHOOK_EVENTS.map((ev) => (
              <div key={ev} className="flex items-center gap-3 rounded-lg border border-white/10 bg-white/5 px-4 py-2">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400"></span>
                <code className="text-sm text-white/70">{ev}</code>
              </div>
            ))}
          </div>
          <div className="mt-6 rounded-xl border border-white/10 bg-[#0d1424] p-6">
            <pre className="font-mono text-sm text-white/70">{`// Verify webhook signature (Node.js)
import { createHmac } from 'crypto';

function verifyWebhook(rawBody: Buffer, signature: string, secret: string) {
  const expected = 'sha256=' + createHmac('sha256', secret)
    .update(rawBody).digest('hex');
  return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}`}</pre>
          </div>
        </div>

        {/* SDK */}
        <div className="mt-16" id="sdk">
          <h2 className="mb-6 text-xl font-bold">TypeScript SDK</h2>
          <div className="rounded-xl border border-white/10 bg-[#0d1424] p-6 font-mono text-sm">
            <pre className="text-white/80">{`import { TixlyClient } from '@tixly/sdk';

const tixly = new TixlyClient({ apiKey: 'tick_live_...' });

// Discovery
const { events, total } = await tixly.events.list({ city: 'Brno', limit: 10 });

// Single event with expansions
const event = await tixly.events.get('event-uuid', ['ticket_classes', 'venue']);

// Real-time inventory
const inv = await tixly.inventory.status({ eventId: 'event-uuid' });

// Register webhook
await tixly.webhooks.create({
  url: 'https://my-app.com/webhooks/tixly',
  event_types: ['order.paid', 'ticket.checked_in'],
});`}</pre>
          </div>
        </div>

        {/* CTA */}
        <div className="mt-16 rounded-2xl border border-white/10 bg-white/5 p-10 text-center">
          <Users className="mx-auto mb-4 h-8 w-8 text-white/30" />
          <h2 className="mb-2 text-2xl font-bold">Ready to integrate?</h2>
          <p className="mb-6 text-white/50">Create your OAuth app in the promoter dashboard and get your API keys instantly.</p>
          <div className="flex justify-center gap-3">
            <Link href="/admin/oauth-apps" className="rounded-lg bg-white px-6 py-2.5 text-sm font-semibold text-[#0a0f1a] hover:bg-white/90">
              Create OAuth App
            </Link>
            <Link href="/partner/apply" className="rounded-lg border border-white/20 px-6 py-2.5 text-sm font-semibold hover:bg-white/5">
              Become a Partner
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
