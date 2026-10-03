'use client';

import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Banknote,
  CalendarDays,
  ShoppingCart,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import Link from 'next/link';
import { DataTable, Column } from '@/components/admin/DataTable';
import { OnboardingChecklist } from '@/components/admin/OnboardingChecklist';
import { PageHeader } from '@/components/admin/PageHeader';
import { SalesSparkline } from '@/components/admin/SalesSparkline';
import { StatCard } from '@/components/admin/StatCard';
import { StatusBadge } from '@/components/admin/StatusBadge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useAdminOrders } from '@/hooks/useAdminData';
import { formatCzk, formatCzechDate } from '@/lib/format';
import type { AdminOrder } from '@/types/admin';

/**
 * Přehled promotéra.
 *
 * Dřív se všechna čísla počítala v prohlížeči z posledních 100 objednávek —
 * dnešní tržba, týdenní trend, čtrnáctidenní graf, průměrná objednávka,
 * počet zákazníků i refund rate byly proto při vyšším objemu nepravdivé.
 * Teď je počítá server nad celou databází (/api/admin/stats/overview) a
 * stránka je jen zobrazuje.
 *
 * Karet je nahoře záměrně jen pět místo původních jedenácti: když nemá nic
 * přednost, nevynikne nic.
 */

/**
 * Peněžní pole jsou null pro roli 'staff' — obsluha u dveří a na pokladně
 * tržby vidět nemá. Server je proto vůbec neposílá.
 */
interface Overview {
  currency: string;
  hasOtherCurrencies: boolean;
  feePercent: number;
  showsMoney: boolean;
  today: { grossHalire: number | null; ordersCount: number; tickets: number };
  week: {
    currentGrossHalire: number;
    previousGrossHalire: number;
    changePercent: number | null;
  } | null;
  totals: {
    ordersCount: number;
    customersCount: number | null;
    grossHalire: number | null;
    refundsHalire: number | null;
    feeHalire: number | null;
    netHalire: number | null;
    avgOrderHalire: number | null;
  };
  daily: Array<{ date: string; grossHalire: number; ordersCount: number }>;
  refundRate30d: number;
  nextEvent: {
    id: string;
    title: string;
    dateStart: string;
    capacity: number | null;
    sold: number | null;
    sellThroughPercent: number | null;
  } | null;
  attention: { refundRequests: number; chargebacks: number };
}

const recentColumns: Column<AdminOrder>[] = [
  {
    key: 'order',
    header: 'Objednávka',
    render: (row) => <div className="font-medium">{row.orderNumber}</div>,
  },
  {
    key: 'buyer',
    header: 'Kupující',
    render: (row) => (
      <div>
        <div className="font-medium">{row.buyerName}</div>
        <div className="text-xs text-muted-foreground">{row.buyerEmail}</div>
      </div>
    ),
  },
  {
    key: 'event',
    header: 'Akce',
    render: (row) => <span className="text-muted-foreground">{row.eventName}</span>,
  },
  {
    key: 'total',
    header: 'Částka',
    className: 'text-right',
    render: (row) => (
      <div className="text-right font-medium tabular-nums">{formatCzk(row.totalHalire)}</div>
    ),
  },
  {
    key: 'status',
    header: 'Stav',
    render: (row) => <StatusBadge status={row.status} />,
  },
  {
    key: 'date',
    header: 'Datum',
    render: (row) => (
      <span className="text-muted-foreground">{formatCzechDate(row.createdAt)}</span>
    ),
  },
];

export default function AdminDashboardPage() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Posledních 8 objednávek — jediné, k čemu se seznam objednávek na přehledu
  // používá. Čísla už se z něj nepočítají.
  const ordersQuery = useAdminOrders({ limit: 8, page: 1 });
  const recent = ordersQuery.data?.items ?? [];

  useEffect(() => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
    fetch('/api/admin/stats/overview', {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Přehled se nepodařilo načíst (HTTP ${res.status}).`);
        return (await res.json()) as Overview;
      })
      .then(setData)
      .catch((e: Error) => setError(e.message));
  }, []);

  const attentionCount = data ? data.attention.refundRequests + data.attention.chargebacks : 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Přehled"
        description="Jak se prodává a co dnes vyžaduje pozornost."
      />

      <OnboardingChecklist />

      {error ? (
        <div className="rounded-lg border border-rose-300 bg-rose-50 p-4 text-sm text-rose-900">
          {error} Zkus stránku načíst znovu.
        </div>
      ) : null}

      {!data ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-28 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
            <StatCard
              title={data.showsMoney ? 'Tržby dnes' : 'Prodej dnes'}
              value={
                data.today.grossHalire !== null
                  ? formatCzk(data.today.grossHalire)
                  : `${data.today.tickets} vstupenek`
              }
              hint={`${data.today.ordersCount} objednávek · ${data.today.tickets} vstupenek`}
              icon={<Banknote className="h-4 w-4" />}
            />
            <StatCard
              title="Tempo 7 dní"
              value={
                !data.week || data.week.changePercent === null
                  ? '—'
                  : `${data.week.changePercent >= 0 ? '+' : ''}${data.week.changePercent} %`
              }
              hint={
                data.week
                  ? `${formatCzk(data.week.currentGrossHalire)} proti ${formatCzk(
                      data.week.previousGrossHalire,
                    )} v předchozích 7 dnech`
                  : 'Dostupné pro vedení akce'
              }
              icon={
                data.week && data.week.changePercent !== null && data.week.changePercent < 0 ? (
                  <TrendingDown className="h-4 w-4" />
                ) : (
                  <TrendingUp className="h-4 w-4" />
                )
              }
            />
            {data.nextEvent ? (
              <StatCard
                title="Nejbližší akce"
                value={
                  data.nextEvent.sellThroughPercent !== null
                    ? `${data.nextEvent.sellThroughPercent} %`
                    : '—'
                }
                hint={`${data.nextEvent.title} · ${formatCzechDate(data.nextEvent.dateStart)}`}
                icon={<CalendarDays className="h-4 w-4" />}
              />
            ) : (
              <StatCard
                title="Nejbližší akce"
                value="—"
                hint="Žádná nadcházející akce"
                icon={<CalendarDays className="h-4 w-4" />}
              />
            )}
            <StatCard
              title="Vyžaduje pozornost"
              value={String(attentionCount)}
              hint={
                attentionCount === 0
                  ? 'Nic nečeká na vyřízení'
                  : `${data.attention.refundRequests} žádostí o vrácení · ${data.attention.chargebacks} chargebacků`
              }
              icon={<AlertTriangle className="h-4 w-4" />}
            />
          </div>

          {data.showsMoney &&
          data.totals.netHalire !== null &&
          data.totals.grossHalire !== null &&
          data.totals.feeHalire !== null &&
          data.totals.refundsHalire !== null ? (
          <Card>
            <CardHeader>
              <CardTitle>Co vám zůstane</CardTitle>
              <CardDescription>
                Za celou dobu prodeje. Po odečtení provize {data.feePercent} % a refundací —
                konečná výplata se může lišit o dočasně zadrženou částku, tu ukazují{' '}
                <Link href="/admin/payouts" className="text-primary underline">
                  Výplaty
                </Link>
                .
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap items-end gap-x-10 gap-y-4">
                <div>
                  <div className="text-3xl font-semibold tabular-nums">
                    {formatCzk(data.totals.netHalire)}
                  </div>
                  <div className="mt-1 text-xs uppercase tracking-wide text-muted-foreground">
                    Čistá tržba
                  </div>
                </div>
                <Figure label="Hrubá tržba" value={formatCzk(data.totals.grossHalire)} />
                <Figure label="Provize" value={`− ${formatCzk(data.totals.feeHalire)}`} />
                <Figure label="Refundace" value={`− ${formatCzk(data.totals.refundsHalire)}`} />
              </div>

              {data.hasOtherCurrencies ? (
                <p className="mt-4 text-xs text-muted-foreground">
                  Zobrazeno v {data.currency}. Máte i objednávky v jiné měně — ty se do těchto
                  čísel nezapočítávají, aby se neslučovaly různé měny.
                </p>
              ) : null}
            </CardContent>
          </Card>
          ) : null}

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
            <StatCard
              title="Objednávky celkem"
              value={String(data.totals.ordersCount)}
              hint="Všechny stavy"
              icon={<ShoppingCart className="h-4 w-4" />}
            />
            <StatCard
              title="Průměrná objednávka"
              value={
                data.totals.avgOrderHalire !== null ? formatCzk(data.totals.avgOrderHalire) : '—'
              }
              hint="Hrubá tržba na objednávku"
            />
            <StatCard
              title="Zákazníci"
              value={
                data.totals.customersCount !== null ? String(data.totals.customersCount) : '—'
              }
              hint="Kdo aspoň jednou zaplatil"
            />
            <StatCard
              title="Podíl refundací"
              value={`${data.refundRate30d} %`}
              hint={data.refundRate30d > 5 ? 'Vyšší než obvyklé' : 'Za posledních 30 dní'}
            />
          </div>

          {data.daily.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>Tržby za posledních 14 dní</CardTitle>
                <CardDescription>
                  Denní součet zaplacených objednávek v {data.currency}.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <SalesSparkline
                  data={data.daily.map((d) => ({ date: d.date, value: d.grossHalire / 100 }))}
                />
              </CardContent>
            </Card>
          ) : null}
        </>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Poslední objednávky</CardTitle>
          <CardDescription>
            Osm nejnovějších.{' '}
            <Link href="/admin/orders" className="text-primary underline">
              Zobrazit všechny
            </Link>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={recentColumns}
            rows={recent}
            rowKey={(o) => o.orderId}
            loading={ordersQuery.isLoading}
            emptyMessage="Zatím žádné objednávky"
          />
        </CardContent>
      </Card>
    </div>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-lg font-medium tabular-nums text-muted-foreground">{value}</div>
      <div className="mt-1 text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
    </div>
  );
}
