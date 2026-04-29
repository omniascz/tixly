'use client';

import { useMemo } from 'react';
import {
  Banknote,
  CalendarDays,
  ShoppingCart,
  Users,
  TrendingUp,
  TrendingDown,
  Ticket,
  Calculator,
} from 'lucide-react';
import { PageHeader } from '@/components/admin/PageHeader';
import { StatCard } from '@/components/admin/StatCard';
import { SalesSparkline } from '@/components/admin/SalesSparkline';
import { DataTable, Column } from '@/components/admin/DataTable';
import { StatusBadge } from '@/components/admin/StatusBadge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useAdminEvents, useAdminOrders } from '@/hooks/useAdminData';
import { formatCzk, formatCzechDate } from '@/lib/format';
import type { AdminOrder } from '@/types/admin';

interface DailyBucket {
  date: string;
  value: number;
}

function buildDailyRevenue(orders: AdminOrder[], days = 14): DailyBucket[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const buckets: DailyBucket[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    buckets.push({ date: d.toISOString().slice(0, 10), value: 0 });
  }

  const index = new Map(buckets.map((b, i) => [b.date, i]));
  for (const o of orders) {
    if (o.status !== 'paid') continue;
    const day = o.createdAt.slice(0, 10);
    const idx = index.get(day);
    if (idx !== undefined) {
      buckets[idx]!.value += o.totalHalire / 100;
    }
  }
  return buckets;
}

const recentColumns: Column<AdminOrder>[] = [
  {
    key: 'order',
    header: 'Objednávka',
    render: (row) => (
      <div className="font-medium">{row.orderNumber}</div>
    ),
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
      <div className="text-right font-medium">{formatCzk(row.totalHalire)}</div>
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
  const eventsQuery = useAdminEvents();
  const ordersQuery = useAdminOrders({ limit: 100, page: 1 });

  const orders = ordersQuery.data?.items ?? [];
  const sparkline = useMemo(() => buildDailyRevenue(orders, 14), [orders]);

  const totalRevenue = ordersQuery.data?.totalRevenueHalire ?? 0;
  const totalOrders = ordersQuery.data?.total ?? 0;
  const uniqueCustomers = useMemo(
    () => new Set(orders.map((o) => o.buyerEmail)).size,
    [orders],
  );
  const upcomingEvents = useMemo(() => {
    const now = Date.now();
    return (eventsQuery.data ?? []).filter((e) => new Date(e.date).getTime() >= now).length;
  }, [eventsQuery.data]);

  const today = useMemo(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const ms = start.getTime();
    return ms;
  }, []);

  const todayStats = useMemo(() => {
    const todays = orders.filter(
      (o) => o.status === 'paid' && new Date(o.createdAt).getTime() >= today,
    );
    const revenue = todays.reduce((s, o) => s + o.totalHalire, 0);
    const tickets = todays.reduce((s, o) => s + o.ticketCount, 0);
    return { revenue, ordersCount: todays.length, tickets };
  }, [orders, today]);

  const aov = useMemo(() => {
    const paid = orders.filter((o) => o.status === 'paid');
    if (paid.length === 0) return 0;
    return Math.round(paid.reduce((s, o) => s + o.totalHalire, 0) / paid.length);
  }, [orders]);

  const weekTrend = useMemo(() => {
    const dayMs = 86_400_000;
    const last7Start = today - 7 * dayMs;
    const prev7Start = today - 14 * dayMs;
    let last = 0;
    let prev = 0;
    for (const o of orders) {
      if (o.status !== 'paid') continue;
      const t = new Date(o.createdAt).getTime();
      if (t >= last7Start && t < today + dayMs) last += o.totalHalire;
      else if (t >= prev7Start && t < last7Start) prev += o.totalHalire;
    }
    if (prev === 0) return { last, prev, percent: null as number | null };
    return { last, prev, percent: Math.round(((last - prev) / prev) * 100) };
  }, [orders, today]);

  const recent = orders.slice(0, 8);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Přehled"
        description="Souhrn vašich prodejů, objednávek a nadcházejících akcí."
      />

      <div>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Dnes
        </h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          <StatCard
            title="Dnešní tržby"
            value={formatCzk(todayStats.revenue)}
            hint="Zaplacené dnes"
            icon={<Banknote className="h-4 w-4" />}
          />
          <StatCard
            title="Dnešní objednávky"
            value={String(todayStats.ordersCount)}
            hint="Počet zaplacených"
            icon={<ShoppingCart className="h-4 w-4" />}
          />
          <StatCard
            title="Prodaných lístků"
            value={String(todayStats.tickets)}
            hint="Dnes"
            icon={<Ticket className="h-4 w-4" />}
          />
          <StatCard
            title="Trend (7d vs předchozích 7d)"
            value={
              weekTrend.percent === null
                ? '—'
                : `${weekTrend.percent >= 0 ? '+' : ''}${weekTrend.percent} %`
            }
            hint={`${formatCzk(weekTrend.last)} (předchozí: ${formatCzk(weekTrend.prev)})`}
            icon={
              weekTrend.percent !== null && weekTrend.percent < 0 ? (
                <TrendingDown className="h-4 w-4" />
              ) : (
                <TrendingUp className="h-4 w-4" />
              )
            }
          />
        </div>
      </div>

      <div>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Celkem
        </h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          <StatCard
            title="Tržby (celkem)"
            value={formatCzk(totalRevenue)}
            hint="Zaplacené objednávky"
            icon={<Banknote className="h-4 w-4" />}
          />
          <StatCard
            title="Objednávky"
            value={String(totalOrders)}
            hint="Všechny stavy"
            icon={<ShoppingCart className="h-4 w-4" />}
          />
          <StatCard
            title="Průměrná hodnota objednávky"
            value={formatCzk(aov)}
            hint="Z paid objednávek"
            icon={<Calculator className="h-4 w-4" />}
          />
          <StatCard
            title="Zákazníci"
            value={String(uniqueCustomers)}
            hint="Unikátní kupující"
            icon={<Users className="h-4 w-4" />}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-1">
        <StatCard
          title="Nadcházející akce"
          value={String(upcomingEvents)}
          hint="V příštích týdnech"
          icon={<CalendarDays className="h-4 w-4" />}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Tržby za posledních 14 dní</CardTitle>
          <CardDescription>Denní součet zaplacených objednávek (Kč)</CardDescription>
        </CardHeader>
        <CardContent>
          <SalesSparkline data={sparkline} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Poslední objednávky</CardTitle>
          <CardDescription>8 nejnovějších napříč všemi stavy</CardDescription>
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
