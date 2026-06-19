'use client';

import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/admin/PageHeader';
import { Button } from '@/components/ui/button';
import { typedGet, typedFetch } from '@/lib/typed-fetch';
import { cn } from '@/lib/utils';

interface SchoolBooking {
  id: string;
  event_id: string;
  event_title: string;
  event_date: string;
  contact_name: string;
  contact_email: string;
  school_name: string;
  student_count: number;
  teacher_count: number;
  total_price_halire: number;
  unit_price_halire: number;
  status: 'pending' | 'confirmed' | 'paid' | 'cancelled';
  group_qr_token: string;
  created_at: string;
}

interface AdminEvent {
  id: string;
  title: string;
}

type BookingStatus = SchoolBooking['status'];

const STATUS_LABEL: Record<BookingStatus, string> = {
  pending: 'Čeká',
  confirmed: 'Potvrzeno',
  paid: 'Zaplaceno',
  cancelled: 'Storno',
};

const STATUS_TONE: Record<BookingStatus, string> = {
  pending: 'bg-amber-100 text-amber-800',
  confirmed: 'bg-blue-100 text-blue-800',
  paid: 'bg-emerald-100 text-emerald-800',
  cancelled: 'bg-rose-100 text-rose-800',
};

function formatKc(halire: number): string {
  return `${Math.round(halire / 100).toLocaleString('cs-CZ')} Kč`;
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('cs-CZ', {
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
  }).format(new Date(iso));
}

function StatusBadge({ status }: { status: BookingStatus }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
        STATUS_TONE[status] ?? 'bg-slate-100 text-slate-700',
      )}
    >
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

export default function SchoolBookingsPage() {
  const [bookings, setBookings] = useState<SchoolBooking[]>([]);
  const [events, setEvents] = useState<AdminEvent[]>([]);
  const [filterEventId, setFilterEventId] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void loadBookings();
    void loadEvents();
  }, []);

  async function loadBookings(eventId?: string) {
    try {
      const url = eventId
        ? `/api/school-bookings?eventId=${eventId}`
        : '/api/school-bookings';
      const data = await typedGet<{ bookings: SchoolBooking[] }>(url);
      setBookings(data.bookings ?? []);
    } catch {
      setError('Nepodařilo se načíst rezervace.');
    }
  }

  async function loadEvents() {
    try {
      const data = await typedGet<{ events: AdminEvent[] }>('/api/admin/events');
      setEvents(data.events ?? []);
    } catch {
      // silent
    }
  }

  async function handleStatusChange(id: string, status: BookingStatus) {
    setError(null);
    setBusy(id);
    try {
      await typedFetch(`/api/admin/school-bookings/${id}`, {
        method: 'PATCH',
        body: { status },
        throwOnError: true,
      });
      setBookings((prev) =>
        prev.map((b) => (b.id === id ? { ...b, status } : b)),
      );
    } catch {
      setError('Změna stavu selhala.');
    } finally {
      setBusy(null);
    }
  }

  function handleEventFilter(eventId: string) {
    setFilterEventId(eventId);
    void loadBookings(eventId || undefined);
  }

  const displayed = filterEventId
    ? bookings.filter((b) => b.event_id === filterEventId)
    : bookings;

  return (
    <div>
      <PageHeader
        title="Školní skupinové objednávky"
        description="Rezervace pro školy s fakturací — 25% sleva, skupinový QR vstup"
      />

      <div className="mb-4 flex items-center gap-3">
        <select
          className="rounded-md border bg-background px-3 py-2 text-sm"
          value={filterEventId}
          onChange={(e) => handleEventFilter(e.target.value)}
        >
          <option value="">Všechny akce</option>
          {events.map((ev) => (
            <option key={ev.id} value={ev.id}>{ev.title}</option>
          ))}
        </select>
        <span className="text-sm text-muted-foreground">
          {displayed.length} {displayed.length === 1 ? 'rezervace' : displayed.length < 5 ? 'rezervace' : 'rezervací'}
        </span>
      </div>

      {error && (
        <div className="mb-4 rounded-md border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-700">
          {error}
        </div>
      )}

      <div className="rounded-md border overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 border-b">
            <tr>
              <th className="px-4 py-3 text-left font-medium">Škola</th>
              <th className="px-4 py-3 text-left font-medium">Kontakt</th>
              <th className="px-4 py-3 text-left font-medium">Akce</th>
              <th className="px-4 py-3 text-left font-medium">Datum akce</th>
              <th className="px-4 py-3 text-right font-medium">Žáků</th>
              <th className="px-4 py-3 text-right font-medium">Cena</th>
              <th className="px-4 py-3 text-center font-medium">Stav</th>
              <th className="px-4 py-3 text-center font-medium">Akce</th>
            </tr>
          </thead>
          <tbody>
            {displayed.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">
                  Žádné rezervace
                </td>
              </tr>
            )}
            {displayed.map((b) => (
              <tr key={b.id} className="border-b last:border-0 hover:bg-muted/20">
                <td className="px-4 py-3">
                  <div className="font-medium">{b.school_name}</div>
                  <div className="text-xs text-muted-foreground">{formatDate(b.created_at)}</div>
                </td>
                <td className="px-4 py-3">
                  <div>{b.contact_name}</div>
                  <div className="text-xs text-muted-foreground">{b.contact_email}</div>
                </td>
                <td className="px-4 py-3 max-w-[200px] truncate">{b.event_title}</td>
                <td className="px-4 py-3 text-muted-foreground">
                  {b.event_date ? formatDate(b.event_date) : '—'}
                </td>
                <td className="px-4 py-3 text-right">
                  {b.student_count}
                  {b.teacher_count > 0 && (
                    <span className="ml-1 text-xs text-muted-foreground">+{b.teacher_count}</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right font-medium">
                  {formatKc(b.total_price_halire)}
                </td>
                <td className="px-4 py-3 text-center">
                  <StatusBadge status={b.status} />
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-center gap-1">
                    {b.status === 'pending' && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy === b.id}
                        onClick={() => void handleStatusChange(b.id, 'confirmed')}
                      >
                        Potvrdit
                      </Button>
                    )}
                    {b.status === 'confirmed' && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy === b.id}
                        onClick={() => void handleStatusChange(b.id, 'paid')}
                      >
                        Zaplaceno
                      </Button>
                    )}
                    {(b.status === 'confirmed' || b.status === 'paid') && (
                      <a
                        href={`/api/admin/school-bookings/${b.id}/qr`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center rounded-md border px-2 py-1 text-xs font-medium hover:bg-muted"
                      >
                        QR
                      </a>
                    )}
                    {b.status !== 'cancelled' && b.status !== 'paid' && (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy === b.id}
                        className="text-rose-600 hover:text-rose-700 hover:bg-rose-50"
                        onClick={() => void handleStatusChange(b.id, 'cancelled')}
                      >
                        Storno
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
