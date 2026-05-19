'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Download, Undo2 } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { DataTable, Column } from '@/components/admin/DataTable';
import { OrderFilters, OrderFiltersValue } from '@/components/admin/OrderFilters';
import { PageHeader } from '@/components/admin/PageHeader';
import { Pagination } from '@/components/admin/Pagination';
import { StatCard } from '@/components/admin/StatCard';
import { StatusBadge } from '@/components/admin/StatusBadge';
import { Button } from '@/components/ui/button';
import { useAdminEvents, useAdminOrders } from '@/hooks/useAdminData';
import { adminApi } from '@/lib/admin-api';
import { formatCzk, formatCzechDate } from '@/lib/format';
import type { AdminOrder, AdminOrderFilters } from '@/types/admin';

const PAGE_SIZE = 20;

function buildColumns(
  onRefund: (order: AdminOrder) => void,
  refundingId: string | null,
  selected: Set<string>,
  toggleSelected: (orderId: string) => void,
  toggleAllSelected: () => void,
  selectableIds: string[],
): Column<AdminOrder>[] {
  const allSelected =
    selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));
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
        className="font-medium text-foreground hover:text-primary hover:underline"
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
        <div className="font-medium">{row.ticketCount} ks</div>
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
      <div className="text-right font-semibold">{formatCzk(row.totalHalire)}</div>
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
      const isRefunding = refundingId === row.orderId;
      return (
        <div className="text-right">
          <Button
            variant="ghost"
            size="sm"
            disabled={isRefunding}
            onClick={() => onRefund(row)}
            className="gap-1 text-rose-700 hover:bg-rose-50 hover:text-rose-800"
          >
            <Undo2 className="h-3.5 w-3.5" aria-hidden />
            {isRefunding ? 'Vracím…' : 'Vrátit'}
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
  const searchParams = useSearchParams();
  const initialEventId = searchParams.get('eventId') ?? '';

  const [filters, setFilters] = useState<OrderFiltersValue>({
    ...EMPTY_FILTERS,
    eventId: initialEventId,
  });
  const [page, setPage] = useState(1);

  useEffect(() => {
    setPage(1);
  }, [filters.eventId, filters.status, filters.search, filters.from, filters.to]);

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
  const [refundingId, setRefundingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);

  const items = ordersQuery.data?.items ?? [];
  const total = ordersQuery.data?.total ?? 0;
  const totalRevenue = ordersQuery.data?.totalRevenueHalire ?? 0;
  const totalPages = ordersQuery.data?.totalPages ?? 1;

  const refundMutation = useMutation({
    mutationFn: async ({ orderId, reason }: { orderId: string; reason: string }) =>
      adminApi.refundOrder(orderId, { reason }),
    onMutate: ({ orderId }) => setRefundingId(orderId),
    onSuccess: (data, vars) => {
      const amountKc = data.refundedAmountHalire ? data.refundedAmountHalire / 100 : null;
      setFeedback(
        data.alreadyRefunded
          ? `Objednávka ${vars.orderId.slice(0, 8)} už byla vrácena.`
          : `Vráceno ${amountKc ?? '?'} Kč. Vstupenek revoke: ${data.revokedTickets ?? 0}.`,
      );
      queryClient.invalidateQueries({ queryKey: ['admin', 'orders'] });
    },
    onError: (err: Error) => {
      setFeedback(`Refund selhal: ${err.message}`);
    },
    onSettled: () => setRefundingId(null),
  });

  const handleRefund = (order: AdminOrder) => {
    if (typeof window !== 'undefined') {
      const ok = window.confirm(
        `Opravdu vrátit objednávku ${order.orderNumber}?\n\n${order.buyerName} · ${order.eventName}\nČástka: ${formatCzk(order.totalHalire)}\n\nVstupenky budou neplatné.`,
      );
      if (!ok) return;
    }
    refundMutation.mutate({ orderId: order.orderId, reason: 'customer_request' });
  };

  const selectableIds = useMemo(
    () => items.filter((o) => o.status === 'paid').map((o) => o.orderId),
    [items],
  );

  function toggleSelected(orderId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(orderId)) next.delete(orderId);
      else next.add(orderId);
      return next;
    });
  }

  function toggleAllSelected() {
    setSelected((prev) => {
      const allSelected = selectableIds.every((id) => prev.has(id));
      if (allSelected) return new Set();
      return new Set(selectableIds);
    });
  }

  async function handleBulkRefund() {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    const total = items
      .filter((o) => selected.has(o.orderId))
      .reduce((s, o) => s + o.totalHalire, 0);
    const ok = window.confirm(
      `Vrátit ${ids.length} objednávek (celkem ${formatCzk(total)})?\n\nVšechny vstupenky budou neplatné.`,
    );
    if (!ok) return;
    setBulkLoading(true);
    try {
      const res = await adminApi.bulkRefund({ orderIds: ids, reason: 'event_cancelled' });
      setFeedback(
        `Hromadný refund: ${res.refundedCount} vráceno (${formatCzk(res.totalRefundedHalire)}), ${res.alreadyRefundedCount} už bylo vráceno, ${res.errorCount} chyb.`,
      );
      setSelected(new Set());
      queryClient.invalidateQueries({ queryKey: ['admin', 'orders'] });
    } catch (err) {
      setFeedback(`Bulk refund selhal: ${(err as Error).message}`);
    } finally {
      setBulkLoading(false);
    }
  }

  const columns = useMemo(
    () =>
      buildColumns(
        handleRefund,
        refundingId,
        selected,
        toggleSelected,
        toggleAllSelected,
        selectableIds,
      ),
    [refundingId, selected, selectableIds],
  );

  const exportHref = adminApi.ordersExportUrl(queryFilters);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Objednávky"
        description="Filtrovatelný seznam objednávek napříč všemi akcemi."
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
        <StatCard title="Objednávek" value={String(total)} hint="Po filtrování" />
        <StatCard title="Tržby" value={formatCzk(totalRevenue)} hint="Po filtrování" />
        <StatCard
          title="Průměr / objednávka"
          value={formatCzk(total > 0 ? Math.round(totalRevenue / total) : 0)}
        />
      </div>

      <div className="rounded-lg border bg-card p-4">
        <OrderFilters
          events={eventsQuery.data ?? []}
          value={filters}
          onChange={setFilters}
        />
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
        <div className="sticky top-0 z-10 flex items-center justify-between rounded-md border border-rose-200 bg-rose-50 px-3 py-2">
          <span className="text-sm text-rose-900">
            Vybráno: {selected.size}
          </span>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
              Zrušit výběr
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={bulkLoading}
              onClick={handleBulkRefund}
              className="gap-1"
            >
              <Undo2 className="h-3.5 w-3.5" aria-hidden />
              {bulkLoading ? 'Vracím…' : `Vrátit ${selected.size} ks`}
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
          emptyMessage="Žádné objednávky neodpovídají filtrům"
        />
        <Pagination page={page} totalPages={totalPages} onChange={setPage} />
      </div>
    </div>
  );
}
