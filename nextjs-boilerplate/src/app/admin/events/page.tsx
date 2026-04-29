'use client';

import Link from 'next/link';
import { CalendarDays, Plus } from 'lucide-react';
import { PageHeader } from '@/components/admin/PageHeader';
import { DataTable, Column } from '@/components/admin/DataTable';
import { EmptyState } from '@/components/admin/EmptyState';
import { Button } from '@/components/ui/button';
import { useAdminEvents } from '@/hooks/useAdminData';
import { formatCzechDate } from '@/lib/format';
import type { AdminEvent } from '@/types/admin';

function computeStatus(date: string): { label: string; tone: string } {
  const ts = new Date(date).getTime();
  const now = Date.now();
  if (ts < now) return { label: 'Proběhlo', tone: 'bg-slate-100 text-slate-600' };
  const days = Math.ceil((ts - now) / (1000 * 60 * 60 * 24));
  if (days <= 7) return { label: 'Brzy', tone: 'bg-amber-100 text-amber-800' };
  return { label: 'Prodej', tone: 'bg-emerald-100 text-emerald-800' };
}

function moderationBadge(status: string | undefined): { label: string; tone: string } | null {
  switch (status) {
    case 'pending_review':
      return { label: 'Čeká na schválení', tone: 'bg-amber-100 text-amber-800' };
    case 'flagged':
      return { label: 'Označeno k revizi', tone: 'bg-orange-100 text-orange-800' };
    case 'rejected':
      return { label: 'Zamítnuto', tone: 'bg-rose-100 text-rose-800' };
    case 'archived':
      return { label: 'Archivováno', tone: 'bg-slate-100 text-slate-600' };
    case 'draft':
      return { label: 'Koncept', tone: 'bg-slate-100 text-slate-600' };
    case 'published':
      return null; // Publikované ukazujeme jen prodejní status (computeStatus)
    default:
      return null;
  }
}

const columns: Column<AdminEvent>[] = [
  {
    key: 'name',
    header: 'Akce',
    render: (row) => (
      <Link
        href={`/admin/orders?eventId=${row.id}`}
        className="font-medium text-foreground hover:text-primary"
      >
        {row.name}
      </Link>
    ),
  },
  {
    key: 'date',
    header: 'Termín',
    render: (row) => (
      <span className="text-muted-foreground">{formatCzechDate(row.date)}</span>
    ),
  },
  {
    key: 'status',
    header: 'Stav',
    render: (row) => {
      const mod = moderationBadge(row.moderationStatus);
      const sale = computeStatus(row.date);
      return (
        <div className="flex flex-col gap-1">
          {mod ? (
            <span
              className={`inline-flex w-fit rounded-full px-2 py-0.5 text-xs font-medium ${mod.tone}`}
            >
              {mod.label}
            </span>
          ) : (
            <span
              className={`inline-flex w-fit rounded-full px-2 py-0.5 text-xs font-medium ${sale.tone}`}
            >
              {sale.label}
            </span>
          )}
          {row.moderationStatus === 'rejected' && row.rejectionReason ? (
            <span className="text-xs text-muted-foreground" title={row.rejectionReason}>
              {row.rejectionReason.length > 60
                ? row.rejectionReason.slice(0, 60) + '…'
                : row.rejectionReason}
            </span>
          ) : null}
        </div>
      );
    },
  },
  {
    key: 'actions',
    header: '',
    className: 'text-right',
    render: (row) => (
      <div className="flex justify-end gap-3 text-xs">
        <Link
          href={`/admin/events/${row.id}/edit`}
          className="font-medium text-primary hover:underline"
        >
          Upravit
        </Link>
        <Link
          href={`/admin/events/${row.id}/season`}
          className="font-medium text-primary hover:underline"
        >
          Sezóna
        </Link>
        <Link
          href={`/admin/events/${row.id}/addons`}
          className="font-medium text-primary hover:underline"
        >
          Add-ons
        </Link>
        <Link
          href={`/admin/events/${row.id}/settings`}
          className="font-medium text-primary hover:underline"
        >
          Nastavení
        </Link>
        <Link
          href={`/admin/events/${row.id}/wristbands`}
          className="font-medium text-primary hover:underline"
        >
          Náramky
        </Link>
        <Link
          href={`/admin/events/${row.id}/live-ops`}
          className="font-medium text-emerald-700 hover:underline"
        >
          Live
        </Link>
        <Link
          href={`/admin/events/${row.id}/sales-report`}
          className="font-medium text-primary hover:underline"
        >
          Reporty
        </Link>
        <Link
          href={`/admin/events/${row.id}/broadcast`}
          className="font-medium text-primary hover:underline"
        >
          Zpráva
        </Link>
        <Link
          href={`/admin/events/${row.id}/lotteries`}
          className="font-medium text-primary hover:underline"
        >
          Losování
        </Link>
        <Link
          href={`/admin/events/${row.id}/hospitality`}
          className="font-medium text-primary hover:underline"
        >
          Hospitality
        </Link>
        <Link
          href={`/admin/events/${row.id}/member-pricing`}
          className="font-medium text-primary hover:underline"
        >
          Member pricing
        </Link>
        <Link
          href={`/admin/events/${row.id}/dynamic-pricing`}
          className="font-medium text-amber-700 hover:underline"
        >
          🔥 Dynamic
        </Link>
        <Link
          href={`/admin/orders?eventId=${row.id}`}
          className="font-medium text-primary hover:underline"
        >
          Objednávky →
        </Link>
      </div>
    ),
  },
];

export default function AdminEventsPage() {
  const { data, isLoading, isError, error } = useAdminEvents();
  const events = data ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Akce"
        description="Seznam vašich akcí. Po kliknutí uvidíte objednávky filtrované na danou akci."
        actions={
          <Link href="/admin/events/new">
            <Button variant="default" size="sm" className="gap-2">
              <Plus className="h-4 w-4" aria-hidden />
              Nová akce
            </Button>
          </Link>
        }
      />

      {isError ? (
        <EmptyState
          title="Nelze načíst akce"
          description={(error as Error)?.message ?? 'Zkuste to prosím znovu.'}
        />
      ) : !isLoading && events.length === 0 ? (
        <EmptyState
          title="Zatím žádné akce"
          description="Vytvořte první akci, abyste mohli začít prodávat vstupenky."
          icon={<CalendarDays className="h-8 w-8" aria-hidden />}
          action={
            <Link href="/admin/events/new">
              <Button size="sm" className="gap-2">
                <Plus className="h-4 w-4" aria-hidden />
                Vytvořit akci
              </Button>
            </Link>
          }
        />
      ) : (
        <DataTable
          columns={columns}
          rows={events}
          rowKey={(e) => e.id}
          loading={isLoading}
          emptyMessage="Zatím žádné akce"
        />
      )}
    </div>
  );
}
