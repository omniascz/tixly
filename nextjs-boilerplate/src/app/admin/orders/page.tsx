'use client';

import { Suspense, useCallback, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Download, Undo2 } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { DataTable, Column } from '@/components/admin/DataTable';
import { OrderFilters, OrderFiltersValue } from '@/components/admin/OrderFilters';
import { PageHeader } from '@/components/admin/PageHeader';
import { Pagination } from '@/components/admin/Pagination';
import { RefundDialog, type RefundSubmit } from '@/components/admin/RefundForm';
import { StatCard } from '@/components/admin/StatCard';
import { StatusBadge } from '@/components/admin/StatusBadge';
import { Button } from '@/components/ui/button';
import { useAdminEvents, useAdminOrders } from '@/hooks/useAdminData';
import { adminApi } from '@/lib/admin-api';
import { formatCzk, formatCzechDate } from '@/lib/format';
import type { AdminOrder, AdminOrderFilters } from '@/types/admin';

const PAGE_SIZE = 20;

/** Co je právě refundováno — jedna objednávka, nebo hromadný výběr. */
type RefundTarget =
  | { kind: 'single'; order: AdminOrder }
  | { kind: 'bulk'; orderIds: string[]; totalHalire: number };

function buildColumns(
  onRefund: (order: AdminOrder) => void,
  selected: Set<string>,
  toggleSelected: (orderId: string) => void,
  toggleAllSelected: () => void,
  selectableIds: string[],
): Column<AdminOrder>[] {
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));
  return [
    {
      key: 'select',
      header: (
        <input
          type="checkbox"
          checked={allSelected}
          onChange={toggleAllSelected}
          aria-label="Vybrat vše"
        />
      ) as unknown as string,
      render: (row) =>
        row.status === 'paid' ? (
          <input
            type="checkbox"
            checked={selected.has(row.orderId)}
            onChange={() => toggleSelected(row.orderId)}
            aria-label={`Vybrat ${row.orderNumber}`}
          />
        ) : null,
    },
    {
      key: 'order',
      header: 'Číslo',
      render: (row) => (
        <Link
          href={`/admin/orders/${row.orderId}`}
          className="font-medium tabular-nums text-foreground hover:text-primary hover:underline"
        >
          {row.orderNumber}
        </Link>
      ),
    },
    {
      key: 'date',
      header: 'Vytvořeno',
      render: (row) => (
        <span className="text-muted-foreground">{formatCzechDate(row.createdAt)}</span>
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
      key: 'tickets',
      header: 'Vstupenky',
      render: (row) => (
        <div>
          <div className="font-medium tabular-nums">{row.ticketCount} ks</div>
          {row.ticketSummary && (
            <div className="text-xs text-muted-foreground">{row.ticketSummary}</div>
          )}
        </div>
      ),
    },
    {
      key: 'total',
      header: 'Částka',
      className: 'text-right',
      render: (row) => (
        <div className="text-right font-semibold tabular-nums">{formatCzk(row.totalHalire)}</div>
      ),
    },
    {
      key: 'status',
      header: 'Stav',
      render: (row) => <StatusBadge status={row.status} />,
    },
    {
      key: 'actions',
      header: '',
      className: 'text-right',
      render: (row) => {
        if (row.status !== 'paid') return null;
        return (
          <div className="text-right">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onRefund(row)}
              className="gap-1 text-rose-700 hover:bg-rose-50 hover:text-rose-800"
            >
              <Undo2 className="h-3.5 w-3.5" aria-hidden />
              Vrátit
            </Button>
          </div>
        );
      },
    },
  ];
}

const EMPTY_FILTERS: OrderFiltersValue = {
  eventId: '',
  status: '',
  search: '',
  from: '',
  to: '',
};

export default function AdminOrdersPage() {
  return (
    <Suspense fallback={<div className="h-64 animate-pulse rounded-lg bg-muted" />}>
      <OrdersView />
    </Suspense>
  );
}

/**
 * Filtry a stránka žijí v URL, ne ve stavu komponenty.
 *
 * Dřív byly v useState, takže návrat z detailu objednávky uživatele vrátil na
 * první stránku bez filtrů — a odfiltrovaný seznam nešlo poslat kolegovi.
 */
function OrdersView() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const filters: OrderFiltersValue = useMemo(
    () => ({
      eventId: searchParams.get('eventId') ?? '',
      status: (searchParams.get('status') ?? '') as OrderFiltersValue['status'],
      search: searchParams.get('search') ?? '',
      from: searchParams.get('from') ?? '',
      to: searchParams.get('to') ?? '',
    }),
    [searchParams],
  );

  const page = Math.max(1, Number(searchParams.get('page') ?? '1') || 1);

  const writeUrl = useCallback(
    (next: OrderFiltersValue, nextPage: number) => {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(next)) {
        if (value) params.set(key, value);
      }
      if (nextPage > 1) params.set('page', String(nextPage));
      const query = params.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [pathname, router],
  );

  // Změna filtru vždy vrací na první stránku — jinak by uživatel skončil
  // na stránce 7 výsledku, který má stránky dvě.
  const setFilters = useCallback(
    (next: OrderFiltersValue) => writeUrl(next, 1),
    [writeUrl],
  );
  const setPage = useCallback(
    (nextPage: number) => writeUrl(filters, nextPage),
    [filters, writeUrl],
  );

  const queryFilters: AdminOrderFilters = useMemo(
    () => ({
      page,
      limit: PAGE_SIZE,
      eventId: filters.eventId || undefined,
      status: filters.status || undefined,
      search: filters.search || undefined,
      from: filters.from || undefined,
      to: filters.to || undefined,
    }),
    [page, filters],
  );

  const eventsQuery = useAdminEvents();
  const ordersQuery = useAdminOrders(queryFilters);
  const queryClient = useQueryClient();

  const [feedback, setFeedback] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [refundTarget, setRefundTarget] = useState<RefundTarget | null>(null);
  const [refundError, setRefundError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const items = ordersQuery.data?.items ?? [];
  const total = ordersQuery.data?.total ?? 0;
  const totalRevenue = ordersQuery.data?.totalRevenueHalire ?? 0;
  const totalPages = ordersQuery.data?.totalPages ?? 1;

  const refundMutation = useMutation({
    mutationFn: async ({ orderId, reason, note }: { orderId: string; reason: string; note?: string }) =>
      adminApi.refundOrder(orderId, { reason, note }),
  });

  const selectableIds = useMemo(
    () => items.filter((o) => o.status === 'paid').map((o) => o.orderId),
    [items],
  );

  const toggleSelected = useCallback((orderId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(orderId)) next.delete(orderId);
      else next.add(orderId);
      return next;
    });
  }, []);

  const toggleAllSelected = useCallback(() => {
    setSelected((prev) => {
      const allSelected = selectableIds.every((id) => prev.has(id));
      return allSelected ? new Set<string>() : new Set(selectableIds);
    });
  }, [selectableIds]);

  const selectedTotal = useMemo(
    () =>
      items.filter((o) => selected.has(o.orderId)).reduce((sum, o) => sum + o.totalHalire, 0),
    [items, selected],
  );

  async function handleRefundSubmit({ reason, note }: RefundSubmit) {
    if (!refundTarget) return;
    setBusy(true);
    setRefundError(null);
    try {
      if (refundTarget.kind === 'single') {
        const data = await refundMutation.mutateAsync({
          orderId: refundTarget.order.orderId,
          reason,
          note,
        });
        setFeedback(
          data.alreadyRefunded
            ? `Objednávka ${refundTarget.order.orderNumber} už byla vrácena dříve.`
            : `Vráceno ${formatCzk(data.refundedAmountHalire ?? 0)} · zneplatněno ${
                data.revokedTickets ?? 0
              } vstupenek.`,
        );
      } else {
        const res = await adminApi.bulkRefund({
          orderIds: refundTarget.orderIds,
          reason,
        });
        setFeedback(
          `Vráceno ${res.refundedCount} objednávek (${formatCzk(res.totalRefundedHalire)}). ` +
            `Už bylo vráceno: ${res.alreadyRefundedCount}. Chyb: ${res.errorCount}.`,
        );
        setSelected(new Set());
      }
      setRefundTarget(null);
      void queryClient.invalidateQueries({ queryKey: ['admin', 'orders'] });
    } catch (err) {
      setRefundError(
        `Vrácení se nepodařilo: ${(err as Error).message}. Objednávka zůstala beze změny.`,
      );
    } finally {
      setBusy(false);
    }
  }

  const columns = useMemo(
    () =>
      buildColumns(
        (order) => {
          setRefundError(null);
          setRefundTarget({ kind: 'single', order });
        },
        selected,
        toggleSelected,
        toggleAllSelected,
        selectableIds,
      ),
    [selected, toggleSelected, toggleAllSelected, selectableIds],
  );

  const exportHref = adminApi.ordersExportUrl(queryFilters);
  const hasFilters = Object.values(filters).some(Boolean);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Objednávky"
        description="Filtrovatelný seznam napříč všemi akcemi. Nastavené filtry zůstávají v adrese, takže se dají poslat dál."
        actions={
          <Button asChild variant="outline" size="sm" className="gap-2">
            <a href={exportHref} download>
              <Download className="h-4 w-4" aria-hidden />
              Export CSV
            </a>
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <StatCard
          title="Objednávek"
          value={String(total)}
          hint={hasFilters ? 'Odpovídá filtrům' : 'Celkem'}
        />
        <StatCard
          title="Tržby"
          value={formatCzk(totalRevenue)}
          hint={hasFilters ? 'Odpovídá filtrům' : 'Celkem'}
        />
        <StatCard
          title="Průměr na objednávku"
          value={formatCzk(total > 0 ? Math.round(totalRevenue / total) : 0)}
        />
      </div>

      <div className="rounded-lg border bg-card p-4">
        <OrderFilters events={eventsQuery.data ?? []} value={filters} onChange={setFilters} />
        {hasFilters ? (
          <button
            type="button"
            onClick={() => setFilters(EMPTY_FILTERS)}
            className="mt-3 text-xs text-muted-foreground underline hover:text-foreground"
          >
            Zrušit filtry
          </button>
        ) : null}
      </div>

      {feedback ? (
        <div
          role="status"
          className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900"
        >
          {feedback}
        </div>
      ) : null}

      {selected.size > 0 ? (
        <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-2 rounded-md border bg-card px-3 py-2 shadow-sm">
          <span className="text-sm">
            Vybráno {selected.size} objednávek · {formatCzk(selectedTotal)}
          </span>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
              Zrušit výběr
            </Button>
            <Button
              variant="destructive"
              size="sm"
              className="gap-1"
              onClick={() => {
                setRefundError(null);
                setRefundTarget({
                  kind: 'bulk',
                  orderIds: Array.from(selected),
                  totalHalire: selectedTotal,
                });
              }}
            >
              <Undo2 className="h-3.5 w-3.5" aria-hidden />
              Vrátit vybrané
            </Button>
          </div>
        </div>
      ) : null}

      <div>
        <DataTable
          columns={columns}
          rows={items}
          rowKey={(o) => o.orderId}
          loading={ordersQuery.isLoading}
          emptyMessage={
            hasFilters
              ? 'Žádná objednávka neodpovídá filtrům. Zkus je zrušit nebo rozšířit období.'
              : 'Zatím žádné objednávky'
          }
        />
        <Pagination page={page} totalPages={totalPages} onChange={setPage} />
      </div>

      {refundTarget ? (
        <RefundDialog
          title={
            refundTarget.kind === 'single'
              ? `Vrátit objednávku ${refundTarget.order.orderNumber}`
              : `Vrátit ${refundTarget.orderIds.length} objednávek`
          }
          consequence={
            refundTarget.kind === 'single'
              ? `Vrátí kupujícímu ${formatCzk(refundTarget.order.totalHalire)} na původní platební metodu, zneplatní ${refundTarget.order.ticketCount} vstupenek, vrátí kapacitu do prodeje a odešle potvrzení e-mailem. Akci nelze vzít zpět.`
              : `Vrátí celkem ${formatCzk(refundTarget.totalHalire)} ${refundTarget.orderIds.length} kupujícím, zneplatní jejich vstupenky a vrátí kapacitu do prodeje. Akci nelze vzít zpět.`
          }
          confirmLabel={
            refundTarget.kind === 'single'
              ? `Potvrzuji vrácení ${formatCzk(refundTarget.order.totalHalire)}.`
              : `Potvrzuji vrácení ${formatCzk(refundTarget.totalHalire)} u ${refundTarget.orderIds.length} objednávek.`
          }
          submitLabel={refundTarget.kind === 'single' ? 'Vrátit peníze' : 'Vrátit vybrané'}
          defaultReason={refundTarget.kind === 'bulk' ? 'event_cancelled' : 'customer_request'}
          busy={busy}
          error={refundError}
          onSubmit={handleRefundSubmit}
          onCancel={() => {
            setRefundTarget(null);
            setRefundError(null);
          }}
        />
      ) : null}
    </div>
  );
}
