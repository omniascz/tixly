'use client';

import { useMemo } from 'react';
import { Wallet } from 'lucide-react';
import { PageHeader } from '@/components/admin/PageHeader';
import { DataTable, Column } from '@/components/admin/DataTable';
import { EmptyState } from '@/components/admin/EmptyState';
import { StatCard } from '@/components/admin/StatCard';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useAdminOrders, useAdminPayouts } from '@/hooks/useAdminData';
import { formatCzk, formatCzechDateShort } from '@/lib/format';
import type { AdminOrder, AdminPayout } from '@/types/admin';

const PAYOUT_FEE_RATE = 0.025;

const columns: Column<AdminPayout>[] = [
  {
    key: 'period',
    header: 'Období',
    render: (row) => (
      <div>
        <div className="font-medium">
          {formatCzechDateShort(row.periodStart)} – {formatCzechDateShort(row.periodEnd)}
        </div>
        <div className="text-xs text-muted-foreground">{row.id}</div>
      </div>
    ),
  },
  {
    key: 'gross',
    header: 'Hrubé tržby',
    className: 'text-right',
    render: (row) => <div className="text-right">{formatCzk(row.grossHalire)}</div>,
  },
  {
    key: 'fees',
    header: 'Poplatky',
    className: 'text-right',
    render: (row) => (
      <div className="text-right text-muted-foreground">−{formatCzk(row.feesHalire)}</div>
    ),
  },
  {
    key: 'net',
    header: 'K výplatě',
    className: 'text-right',
    render: (row) => (
      <div className="text-right font-semibold">{formatCzk(row.netHalire)}</div>
    ),
  },
  {
    key: 'status',
    header: 'Stav',
    render: (row) => {
      const map: Record<AdminPayout['status'], { label: string; tone: string }> = {
        pending: { label: 'Připravuje se', tone: 'bg-slate-100 text-slate-700' },
        processing: { label: 'Zpracovává se', tone: 'bg-amber-100 text-amber-800' },
        paid: { label: 'Vyplaceno', tone: 'bg-emerald-100 text-emerald-800' },
        failed: { label: 'Selhalo', tone: 'bg-rose-100 text-rose-800' },
      };
      const s = map[row.status];
      return (
        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${s.tone}`}>
          {s.label}
        </span>
      );
    },
  },
  {
    key: 'paidAt',
    header: 'Vyplaceno',
    render: (row) => (
      <span className="text-muted-foreground">
        {row.paidAt ? formatCzechDateShort(row.paidAt) : '—'}
      </span>
    ),
  },
];

interface DerivedPayout extends AdminPayout {
  ordersCount: number;
}

function buildSyntheticPayouts(orders: AdminOrder[]): DerivedPayout[] {
  const buckets = new Map<string, { gross: number; count: number; latest: string }>();
  for (const o of orders) {
    if (o.status !== 'paid') continue;
    const d = new Date(o.createdAt);
    const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const existing = buckets.get(monthKey);
    if (existing) {
      existing.gross += o.totalHalire;
      existing.count += 1;
      if (o.createdAt > existing.latest) existing.latest = o.createdAt;
    } else {
      buckets.set(monthKey, { gross: o.totalHalire, count: 1, latest: o.createdAt });
    }
  }

  const now = new Date();
  const currentKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  const list: DerivedPayout[] = [];
  for (const [key, b] of buckets.entries()) {
    const [yearStr, monthStr] = key.split('-');
    const year = Number(yearStr);
    const month = Number(monthStr) - 1;
    const periodStart = new Date(year, month, 1).toISOString();
    const periodEnd = new Date(year, month + 1, 0).toISOString();
    const fees = Math.round(b.gross * PAYOUT_FEE_RATE);
    list.push({
      id: `PAY-${key}`,
      periodStart,
      periodEnd,
      grossHalire: b.gross,
      feesHalire: fees,
      netHalire: b.gross - fees,
      status: key === currentKey ? 'pending' : 'paid',
      paidAt: key === currentKey ? null : periodEnd,
      ordersCount: b.count,
    });
  }

  list.sort((a, b) => (a.periodStart < b.periodStart ? 1 : -1));
  return list;
}

export default function AdminPayoutsPage() {
  const ordersQuery = useAdminOrders({ status: 'paid', limit: 100, page: 1 });
  const persistedQuery = useAdminPayouts();

  const synthetic = useMemo(
    () => buildSyntheticPayouts(ordersQuery.data?.items ?? []),
    [ordersQuery.data],
  );

  const persisted = persistedQuery.data ?? [];
  const payouts: AdminPayout[] = persisted.length > 0 ? persisted : synthetic;

  const totalPaid = payouts
    .filter((p) => p.status === 'paid')
    .reduce((sum, p) => sum + p.netHalire, 0);
  const totalPending = payouts
    .filter((p) => p.status !== 'paid')
    .reduce((sum, p) => sum + p.netHalire, 0);

  const isLoading = ordersQuery.isLoading || persistedQuery.isLoading;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Výplaty"
        description="Měsíční výplatní období. Hrubé tržby minus platební poplatky (2,5 %)."
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <StatCard title="Vyplaceno celkem" value={formatCzk(totalPaid)} hint="Všechna období" />
        <StatCard title="Čeká na výplatu" value={formatCzk(totalPending)} />
        <StatCard
          title="Sazba poplatků"
          value={`${(PAYOUT_FEE_RATE * 100).toFixed(1)} %`}
          hint="Karty + bankovní převody"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Bankovní účet pro výplaty</CardTitle>
          <CardDescription>
            Platby probíhají do 5 pracovních dnů od konce výplatního období.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border bg-muted/30 p-3 text-sm">
            <div className="font-mono">CZ65 0800 0000 0019 2000 1450</div>
            <div className="mt-1 text-xs text-muted-foreground">
              Změnu účtu vyřídíte na podpora@tixly.cz
            </div>
          </div>
        </CardContent>
      </Card>

      {payouts.length === 0 && !isLoading ? (
        <EmptyState
          title="Zatím žádné výplaty"
          description="Jakmile se objeví zaplacené objednávky, sestavíme první výplatní období."
          icon={<Wallet className="h-8 w-8" aria-hidden />}
        />
      ) : (
        <DataTable
          columns={columns}
          rows={payouts}
          rowKey={(p) => p.id}
          loading={isLoading}
          emptyMessage="Zatím žádné výplaty"
        />
      )}
    </div>
  );
}
