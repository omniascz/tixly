'use client';

import { CalendarDays, Plus } from 'lucide-react';
import Link from 'next/link';
import { DataTable, Column } from '@/components/admin/DataTable';
import { EmptyState } from '@/components/admin/EmptyState';
import { PageHeader } from '@/components/admin/PageHeader';
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
    // Kolo 12: zrušený termín se dřív ukazoval jako „Prodej"
    case 'cancelled':
      return { label: 'Zrušeno', tone: 'bg-rose-100 text-rose-800' };
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
    // Kolo 12: bez města se termíny jedné inscenace nedaly rozlišit (pokladní vybrala špatný termín)
    key: 'venue',
    header: 'Místo',
    render: (row) => (
      <span className="text-muted-foreground">
        {row.venueCity ? <span className="font-medium text-foreground">{row.venueCity}</span> : null}
        {row.venueName ? <span className="block text-xs">{row.venueName}</span> : null}
      </span>
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
      // Kolo 12: dřív 14 odkazů na řádek (část anglicky: Add-ons, Live, Member pricing, Dynamic…); všechny nástroje
      // jsou v záložkách termínu (Otevřít), sem patří jen to, co se dělá denně.
      <div className="flex justify-end gap-3 text-xs">
        <Link href={`/admin/events/${row.id}`} className="font-medium text-primary hover:underline">
          Otevřít
        </Link>
        <Link href={`/admin/events/${row.id}/edit`} className="font-medium text-primary hover:underline">
          Upravit údaje
        </Link>
        <CloneButton eventId={row.id} eventTitle={row.name} />
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

function CloneButton({ eventId, eventTitle }: { eventId: string; eventTitle: string }): JSX.Element {
  return (
    <button
      type="button"
      className="font-medium text-purple-700 hover:underline"
      onClick={async () => {
        const newTitle = prompt(`Název kopie akce "${eventTitle}":`, `${eventTitle} (kopie)`);
        if (!newTitle) return;
        const newDate = prompt('Datum a čas kopie (rok-měsíc-den hodina:minuta, např. 2026-12-31 20:00):', '2026-12-31 20:00');
        if (!newDate) return;
        try {
          const iso = new Date(newDate.replace(' ', 'T')).toISOString();
          const r = await fetch(`/api/admin/events/${eventId}/clone`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ newTitle, newDateStart: iso }),
          });
          const data = await r.json() as { newEventId?: string; error?: string; cloned?: { ticket_types: number } };
          if (!r.ok) {
            alert(`Kopii se nepodařilo vytvořit (${r.status === 403 ? 'nemáte oprávnění' : 'zkontrolujte datum a zkuste to znovu'}).`);
            return;
          }
          alert(`Akce naklonována. ${data.cloned?.ticket_types ?? 0} typů lístků zkopírováno.`);
          window.location.href = `/admin/events/${data.newEventId}/edit`;
        } catch (e) {
          alert(e instanceof Error ? e.message : 'Chyba');
        }
      }}
    >
      Kopírovat
    </button>
  );
}

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
          description={(error)?.message ?? 'Zkuste to prosím znovu.'}
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
