import Link from 'next/link';
import { redirect } from 'next/navigation';
import { db as rlsDb } from '@/lib/db/rls-pool';
import { runAsServerPlatformAdmin } from '@/lib/server-session';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface Counts {
  pending: number;
  active: number;
  suspended: number;
  total_events: number;
  pending_review: number;
}

interface RevenueRow {
  currency: string;
  gross_30d: string;
  refunds_30d: string;
  chargebacks_30d: string;
  paid_orders_30d: string;
}

interface TopPromoterRow {
  id: string;
  name: string;
  slug: string | null;
  country: string;
  primary_currency: string;
  gross_30d: string;
  events_30d: string;
}

interface ReserveRow {
  total_held: string;
  upcoming_release_7d: string;
}

interface RecentWebhookRow {
  provider: string;
  event_type: string;
  status: string;
  count: string;
}

interface ProviderStatus {
  name: string;
  configured: boolean;
  category: string;
}

async function fetchOverview() {
  // Platform-admin kontext z accessToken cookie. Pod ENFORCED RLS musí být nastaven,
  // jinak agregace přes promotéry/orders vrátí 0. Null = nepřihlášený admin.
  return runAsServerPlatformAdmin(async () => {
    const [counts, revenue, topPromoters, reserves, webhooks] = await Promise.all([
      rlsDb().query<Counts>(`
        SELECT
          COUNT(*) FILTER (WHERE p.status='pending')::int AS pending,
          COUNT(*) FILTER (WHERE p.status='active')::int AS active,
          COUNT(*) FILTER (WHERE p.status='suspended')::int AS suspended,
          (SELECT COUNT(*)::int FROM catalog.events) AS total_events,
          (SELECT COUNT(*)::int FROM catalog.events WHERE status IN ('pending_review','flagged')) AS pending_review
        FROM platform.promoters p
      `),
      rlsDb().query<RevenueRow>(`
        SELECT
          COALESCE(currency, 'CZK') AS currency,
          COALESCE(SUM(total_amount) FILTER (WHERE status = 'paid'), 0)::text AS gross_30d,
          COALESCE(SUM(total_amount) FILTER (WHERE status = 'refunded'), 0)::text AS refunds_30d,
          COALESCE(
            (SELECT SUM(amount_halire) FROM orders.chargebacks
             WHERE created_at > NOW() - INTERVAL '30 days'),
            0
          )::text AS chargebacks_30d,
          COUNT(*) FILTER (WHERE status = 'paid')::text AS paid_orders_30d
        FROM orders.orders
        WHERE created_at > NOW() - INTERVAL '30 days'
        GROUP BY COALESCE(currency, 'CZK')
        ORDER BY currency
      `).catch(() => ({ rows: [] as RevenueRow[] })),
      rlsDb().query<TopPromoterRow>(`
        SELECT p.id, p.name, p.slug, p.country, p.primary_currency,
               COALESCE(SUM(o.total_amount) FILTER (WHERE o.status = 'paid'), 0)::text AS gross_30d,
               COUNT(DISTINCT e.id) FILTER (
                 WHERE e.status = 'published' AND e.date_start > NOW() - INTERVAL '30 days'
               )::text AS events_30d
        FROM platform.promoters p
        LEFT JOIN catalog.events e ON e.promoter_id = p.id
        LEFT JOIN orders.orders o ON o.event_id = e.id AND o.created_at > NOW() - INTERVAL '30 days'
        WHERE p.status = 'active'
        GROUP BY p.id
        ORDER BY SUM(o.total_amount) FILTER (WHERE o.status = 'paid') DESC NULLS LAST
        LIMIT 5
      `).catch(() => ({ rows: [] as TopPromoterRow[] })),
      rlsDb().query<ReserveRow>(`
        SELECT
          COALESCE(SUM(amount), 0)::text AS total_held,
          COALESCE(SUM(amount) FILTER (
            WHERE release_date <= CURRENT_DATE + INTERVAL '7 days'
          ), 0)::text AS upcoming_release_7d
        FROM platform.rolling_reserves
        WHERE released = FALSE
      `).catch(() => ({
        rows: [{ total_held: '0', upcoming_release_7d: '0' }] as ReserveRow[],
      })),
      rlsDb().query<RecentWebhookRow>(`
        SELECT
          COALESCE(payment_provider, 'unknown') AS provider,
          event_type,
          'received' AS status,
          COUNT(*)::text AS count
        FROM orders.payment_events
        WHERE created_at > NOW() - INTERVAL '24 hours'
        GROUP BY payment_provider, event_type
        ORDER BY COUNT(*) DESC
        LIMIT 8
      `).catch(() => ({ rows: [] as RecentWebhookRow[] })),
    ]);

    return {
      counts: counts.rows[0],
      revenue: revenue.rows,
      topPromoters: topPromoters.rows,
      reserves: reserves.rows[0] ?? { total_held: '0', upcoming_release_7d: '0' },
      webhooks: webhooks.rows,
    };
  });
}

async function fetchProviders(): Promise<{ launchReady: boolean; providers: ProviderStatus[] }> {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  try {
    const res = await fetch(`${baseUrl}/api/health/providers`, { cache: 'no-store' });
    if (!res.ok) return { launchReady: false, providers: [] };
    return (await res.json()) as { launchReady: boolean; providers: ProviderStatus[] };
  } catch {
    return { launchReady: false, providers: [] };
  }
}

function fmtMoney(halire: string | number, currency: string): string {
  const n = typeof halire === 'string' ? Number(halire) : halire;
  const amount = (n / 100).toLocaleString('cs-CZ', { maximumFractionDigits: 0 });
  return amount + (currency === 'EUR' ? ' €' : ' Kč');
}

export const dynamic = 'force-dynamic';

export default async function PlatformDashboard() {
  const [overview, providers] = await Promise.all([fetchOverview(), fetchProviders()]);
  // overview === null → není přihlášený platform admin (middleware by to mělo zachytit dřív;
  // defense in depth pod ENFORCED RLS, kdy by jinak agregace vrátila prázdno).
  if (!overview) redirect('/cs/login?from=/platform');
  const c = overview.counts;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <h1 className="text-3xl font-bold">Platform overview</h1>
        <Link
          href="/api/health/providers"
          className={`rounded-full px-3 py-1 text-xs font-medium ${
            providers.launchReady
              ? 'bg-emerald-100 text-emerald-800'
              : 'bg-amber-100 text-amber-800'
          }`}
        >
          {providers.launchReady ? '🟢 Launch ready' : '🟡 Setup in progress'}
        </Link>
      </div>

      {/* Top stats */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm text-muted-foreground">Pending promotéři</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-amber-600">{c.pending}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm text-muted-foreground">Aktivní</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-emerald-600">{c.active}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm text-muted-foreground">Suspended</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-rose-600">{c.suspended}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm text-muted-foreground">Akcí celkem</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{c.total_events}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm text-muted-foreground">Ke schválení</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-amber-600">{c.pending_review}</div>
          </CardContent>
        </Card>
      </div>

      {/* Revenue per currency (30d) */}
      <Card>
        <CardHeader>
          <CardTitle>💰 Gross volume — posledních 30 dní</CardTitle>
        </CardHeader>
        <CardContent>
          {overview.revenue.length === 0 ? (
            <p className="text-sm text-muted-foreground">Žádné objednávky v posledních 30 dnech.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                  <th className="py-2">Měna</th>
                  <th className="text-right">Gross</th>
                  <th className="text-right">Refundy</th>
                  <th className="text-right">Chargebacky</th>
                  <th className="text-right">Net</th>
                  <th className="text-right">Objednávek</th>
                </tr>
              </thead>
              <tbody>
                {overview.revenue.map((r) => {
                  const gross = Number(r.gross_30d);
                  const refunds = Number(r.refunds_30d);
                  const chargebacks = Number(r.chargebacks_30d);
                  return (
                    <tr key={r.currency} className="border-b">
                      <td className="py-2 font-medium">{r.currency}</td>
                      <td className="text-right">{fmtMoney(gross, r.currency)}</td>
                      <td className="text-right text-rose-700">
                        −{fmtMoney(refunds, r.currency)}
                      </td>
                      <td className="text-right text-rose-700">
                        −{fmtMoney(chargebacks, r.currency)}
                      </td>
                      <td className="text-right font-semibold">
                        {fmtMoney(gross - refunds - chargebacks, r.currency)}
                      </td>
                      <td className="text-right text-muted-foreground">{r.paid_orders_30d}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Top promotéři */}
        <Card>
          <CardHeader>
            <CardTitle>🏆 Top 5 promotéři (30d)</CardTitle>
          </CardHeader>
          <CardContent>
            {overview.topPromoters.length === 0 ? (
              <p className="text-sm text-muted-foreground">Žádná data.</p>
            ) : (
              <ol className="space-y-2">
                {overview.topPromoters.map((p, i) => (
                  <li
                    key={p.id}
                    className="flex items-center justify-between gap-2 rounded-md border p-2 text-sm"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">#{i + 1}</span>
                        <Link
                          href={`/platform/promoters/${p.id}`}
                          className="truncate font-medium hover:text-primary"
                        >
                          {p.name}
                        </Link>
                        <span className="text-xs text-muted-foreground">
                          {p.country === 'SR' ? '🇸🇰' : '🇨🇿'}
                        </span>
                      </div>
                      <div className="ml-7 text-xs text-muted-foreground">
                        {p.events_30d} akcí · {p.primary_currency}
                      </div>
                    </div>
                    <div className="text-right font-semibold">
                      {fmtMoney(p.gross_30d, p.primary_currency)}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>

        {/* Holdback reserves */}
        <Card>
          <CardHeader>
            <CardTitle>💼 Rolling reserves (holdback)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <div className="text-xs uppercase text-muted-foreground">Aktuálně držené</div>
              <div className="text-3xl font-bold">
                {fmtMoney(overview.reserves.total_held, 'CZK')}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Suma chargeback-risk rezerv napříč všemi promotéry.
              </p>
            </div>
            <div className="border-t pt-3">
              <div className="text-xs uppercase text-muted-foreground">Uvolnění v 7 dnech</div>
              <div className="text-xl font-semibold text-amber-700">
                {fmtMoney(overview.reserves.upcoming_release_7d, 'CZK')}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Cron /api/internal/cron/release-rolling-reserves to uvolní.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Webhook activity */}
        <Card>
          <CardHeader>
            <CardTitle>📡 Webhook activity (24h)</CardTitle>
          </CardHeader>
          <CardContent>
            {overview.webhooks.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Žádné webhook eventy v posledních 24h.
              </p>
            ) : (
              <ul className="space-y-1">
                {overview.webhooks.map((w, i) => (
                  <li
                    key={`${w.provider}-${w.event_type}-${i}`}
                    className="flex items-center justify-between gap-2 rounded border p-2 text-sm"
                  >
                    <div>
                      <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-medium">
                        {w.provider}
                      </span>
                      <span className="ml-2 text-xs">{w.event_type}</span>
                    </div>
                    <span className="text-sm font-semibold tabular-nums">{w.count}×</span>
                  </li>
                ))}
              </ul>
            )}
            <Link
              href="/platform/webhooks"
              className="mt-3 inline-block text-xs text-primary hover:underline"
            >
              Viz všechny webhooks →
            </Link>
          </CardContent>
        </Card>

        {/* Provider health */}
        <Card>
          <CardHeader>
            <CardTitle>⚙️ Providers — health</CardTitle>
          </CardHeader>
          <CardContent>
            {providers.providers.length === 0 ? (
              <p className="text-sm text-muted-foreground">Health endpoint nedostupný.</p>
            ) : (
              <ul className="space-y-1">
                {providers.providers
                  .filter((p) => p.category !== 'monitoring' && p.category !== 'ai')
                  .map((p) => (
                    <li
                      key={p.name}
                      className="flex items-center justify-between gap-2 rounded border p-2 text-sm"
                    >
                      <span className="truncate">{p.name}</span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs ${
                          p.configured
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-rose-100 text-rose-800'
                        }`}
                      >
                        {p.configured ? '✓' : '✗'}
                      </span>
                    </li>
                  ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
