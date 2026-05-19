'use client';

import { useMemo, useState } from 'react';
import { Search, Users } from 'lucide-react';
import { DataTable, Column } from '@/components/admin/DataTable';
import { EmptyState } from '@/components/admin/EmptyState';
import { PageHeader } from '@/components/admin/PageHeader';
import { StatCard } from '@/components/admin/StatCard';
import { Input } from '@/components/ui/input';
import { useAdminCustomers } from '@/hooks/useAdminData';
import { formatCzk, formatCzechDateShort } from '@/lib/format';
import type { AdminCustomer } from '@/types/admin';

type Segment = 'champion' | 'loyal' | 'new' | 'at_risk' | 'lost';

function classifyCustomer(c: AdminCustomer): {
  segment: Segment;
  label: string;
  tone: string;
} {
  const daysSinceLast = Math.floor(
    (Date.now() - new Date(c.lastOrderAt).getTime()) / 86_400_000,
  );
  if (daysSinceLast > 365) return { segment: 'lost', label: 'Ztracený', tone: 'bg-slate-100 text-slate-600' };
  if (daysSinceLast > 180) return { segment: 'at_risk', label: 'V ohrožení', tone: 'bg-rose-100 text-rose-800' };
  if (c.ordersCount >= 5 && c.totalSpentHalire >= 200_000)
    return { segment: 'champion', label: 'Champion', tone: 'bg-emerald-100 text-emerald-800' };
  if (c.ordersCount >= 2)
    return { segment: 'loyal', label: 'Vracející se', tone: 'bg-blue-100 text-blue-800' };
  return { segment: 'new', label: 'Nový', tone: 'bg-amber-100 text-amber-800' };
}

const columns: Column<AdminCustomer>[] = [
  {
    key: 'name',
    header: 'Zákazník',
    render: (row) => (
      <div>
        <div className="font-medium">{row.name}</div>
        <div className="text-xs text-muted-foreground">{row.email}</div>
      </div>
    ),
  },
  {
    key: 'phone',
    header: 'Telefon',
    render: (row) => (
      <span className="text-muted-foreground">{row.phone ?? '—'}</span>
    ),
  },
  {
    key: 'orders',
    header: 'Objednávek',
    className: 'text-right',
    render: (row) => <div className="text-right font-medium">{row.ordersCount}</div>,
  },
  {
    key: 'spent',
    header: 'Útrata',
    className: 'text-right',
    render: (row) => (
      <div className="text-right font-semibold">{formatCzk(row.totalSpentHalire)}</div>
    ),
  },
  {
    key: 'last',
    header: 'Poslední objednávka',
    render: (row) => (
      <span className="text-muted-foreground">{formatCzechDateShort(row.lastOrderAt)}</span>
    ),
  },
  {
    key: 'segment',
    header: 'Segment',
    render: (row) => {
      const s = classifyCustomer(row);
      return (
        <span
          className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${s.tone}`}
        >
          {s.label}
        </span>
      );
    },
  },
];

export default function AdminCustomersPage() {
  const { data, isLoading, isError, error } = useAdminCustomers();
  const [search, setSearch] = useState('');

  // Memoize fallback empty array tak, aby `data ?? []` neměnil identitu
  // mezi rendery — dva useMemo níže pak nepřepočítávají zbytečně.
  const customers = useMemo(() => data ?? [], [data]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.email.toLowerCase().includes(q) ||
        (c.phone ?? '').toLowerCase().includes(q),
    );
  }, [customers, search]);

  const totalSpent = useMemo(
    () => customers.reduce((sum, c) => sum + c.totalSpentHalire, 0),
    [customers],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Zákazníci"
        description="Souhrn unikátních kupujících podle e-mailu (pouze zaplacené objednávky)."
      />

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard title="Zákazníků celkem" value={String(customers.length)} />
        <StatCard
          title="Průměrná útrata"
          value={formatCzk(
            customers.length > 0 ? Math.round(totalSpent / customers.length) : 0,
          )}
        />
        <StatCard
          title="Champions"
          value={String(
            customers.filter((c) => classifyCustomer(c).segment === 'champion').length,
          )}
          hint="≥5 objednávek a ≥2 000 Kč"
        />
        <StatCard
          title="V ohrožení / ztracení"
          value={String(
            customers.filter((c) => {
              const s = classifyCustomer(c).segment;
              return s === 'at_risk' || s === 'lost';
            }).length,
          )}
          hint="180+ dní bez nákupu"
        />
      </div>

      <div className="rounded-lg border bg-card p-4">
        <div className="relative max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Hledat podle jména, e-mailu nebo telefonu"
            className="pl-9"
          />
        </div>
      </div>

      {isError ? (
        <EmptyState
          title="Nelze načíst zákazníky"
          description={(error)?.message ?? 'Zkuste to prosím znovu.'}
        />
      ) : !isLoading && customers.length === 0 ? (
        <EmptyState
          title="Zatím žádní zákazníci"
          description="Jakmile se objeví první zaplacená objednávka, uvidíte zde kupujícího."
          icon={<Users className="h-8 w-8" aria-hidden />}
        />
      ) : (
        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(c) => c.email}
          loading={isLoading}
          emptyMessage="Žádný zákazník neodpovídá hledání"
        />
      )}
    </div>
  );
}
