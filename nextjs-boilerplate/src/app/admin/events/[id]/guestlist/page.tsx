'use client';

import { useEffect, useState, use } from 'react';
import { PageHeader } from '@/components/admin/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useRouteParams } from '@/lib/next/route-params';

interface GuestlistEntry {
  id: string;
  guest_name: string;
  guest_email: string;
  notes: string | null;
  invited_by: string | null;
  status: 'invited' | 'confirmed' | 'attended' | 'no_show' | 'cancelled';
  ticket_id: string | null;
  order_id: string | null;
  checked_in_at: string | null;
  created_at: string;
}

const STATUS_BADGE: Record<string, string> = {
  invited: 'bg-slate-100 text-slate-800',
  confirmed: 'bg-blue-100 text-blue-800',
  attended: 'bg-emerald-100 text-emerald-800',
  no_show: 'bg-rose-100 text-rose-800',
  cancelled: 'bg-slate-100 text-slate-400 line-through',
};

const STATUS_LABEL: Record<string, string> = {
  invited: 'Pozván',
  confirmed: 'Potvrzeno',
  attended: 'Přišel',
  no_show: 'Nedorazil',
  cancelled: 'Zrušeno',
};

function authFetch(url: string, init?: RequestInit): Promise<Response> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
  return fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
}

export default function GuestlistPage(
  props: {
    params: Promise<{ id: string }>;
  }
) {
  const params = use(props.params);
  const { id: eventId } = useRouteParams(params);

  const [entries, setEntries] = useState<GuestlistEntry[]>([]);
  const [totalGuests, setTotalGuests] = useState(0);
  const [capacity, setCapacity] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [guestName, setGuestName] = useState('');
  const [guestEmail, setGuestEmail] = useState('');
  const [invitedBy, setInvitedBy] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    void load();
  }, [eventId]);

  async function load(): Promise<void> {
    try {
      const res = await authFetch(`/api/admin/events/${eventId}/guestlist`);
      if (!res.ok) {
        setError(`HTTP ${res.status}`);
        return;
      }
      const j = (await res.json()) as {
        entries: GuestlistEntry[];
        totalGuests: number;
        capacity: number | null;
      };
      setEntries(j.entries);
      setTotalGuests(j.totalGuests);
      setCapacity(j.capacity);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function addGuest(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await authFetch(`/api/admin/events/${eventId}/guestlist`, {
        method: 'POST',
        body: JSON.stringify({
          guestName: guestName.trim(),
          guestEmail: guestEmail.trim(),
          invitedBy: invitedBy.trim() || undefined,
          notes: notes.trim() || undefined,
        }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(j.error ?? `HTTP ${res.status}`);
        return;
      }
      setGuestName('');
      setGuestEmail('');
      setInvitedBy('');
      setNotes('');
      setSuccess(`Host ${guestName} přidán, vstupenka vystavena.`);
      await load();
    } finally {
      setSubmitting(false);
    }
  }

  async function checkIn(entryId: string): Promise<void> {
    setBusy(entryId);
    setError(null);
    setSuccess(null);
    try {
      const res = await authFetch(`/api/admin/events/${eventId}/guestlist`, {
        method: 'PATCH',
        body: JSON.stringify({ entryId, status: 'attended' }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(j.error ?? `HTTP ${res.status}`);
        return;
      }
      await load();
    } finally {
      setBusy(null);
    }
  }

  async function remove(entryId: string, name: string): Promise<void> {
    if (!window.confirm(`Zrušit vstupenku pro ${name}?`)) return;
    setBusy(entryId);
    setError(null);
    setSuccess(null);
    try {
      const res = await authFetch(`/api/admin/events/${eventId}/guestlist`, {
        method: 'DELETE',
        body: JSON.stringify({ entryId }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(j.error ?? `HTTP ${res.status}`);
        return;
      }
      await load();
    } finally {
      setBusy(null);
    }
  }

  const activeEntries = entries.filter((e) => e.status !== 'cancelled');

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Guestlist"
        description={
          capacity !== null
            ? `Zdarma vstupenky pro hosty, VIP a partnery. Hostů: ${totalGuests} z ${capacity} míst celkové kapacity.`
            : `Zdarma vstupenky pro hosty, VIP a partnery. Celkem hostů: ${totalGuests}.`
        }
      />

      {error ? (
        <div className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">
          {error}
        </div>
      ) : null}
      {success ? (
        <div className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">
          {success}
        </div>
      ) : null}

      <Card>
        <CardContent className="pt-6">
          <form onSubmit={(e) => void addGuest(e)} className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium">Jméno hosta *</label>
                <Input
                  value={guestName}
                  onChange={(e) => setGuestName(e.target.value)}
                  placeholder="Jana Nováková"
                  required
                  maxLength={200}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Email *</label>
                <Input
                  type="email"
                  value={guestEmail}
                  onChange={(e) => setGuestEmail(e.target.value)}
                  placeholder="jana@example.cz"
                  required
                  maxLength={200}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Kdo pozval</label>
                <Input
                  value={invitedBy}
                  onChange={(e) => setInvitedBy(e.target.value)}
                  placeholder="Ředitel divadla"
                  maxLength={200}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Poznámka</label>
                <Input
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="VIP místo, alergie…"
                  maxLength={1000}
                />
              </div>
            </div>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Přidávám…' : 'Přidat hosta a vystavit vstupenku'}
            </Button>
          </form>
        </CardContent>
      </Card>

      {activeEntries.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            Guestlist je prázdná.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/40 text-xs uppercase text-muted-foreground">
                    <th className="px-4 py-2 text-left font-medium">Jméno</th>
                    <th className="px-4 py-2 text-left font-medium">Email</th>
                    <th className="px-4 py-2 text-left font-medium">Pozval</th>
                    <th className="px-4 py-2 text-left font-medium">Status</th>
                    <th className="px-4 py-2 text-left font-medium">Ticket ID</th>
                    <th className="px-4 py-2 text-left font-medium">Akce</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => (
                    <tr key={entry.id} className="border-b last:border-0 hover:bg-muted/20">
                      <td className="px-4 py-2 font-medium">
                        {entry.guest_name}
                        {entry.notes ? (
                          <p className="text-[11px] text-muted-foreground">{entry.notes}</p>
                        ) : null}
                      </td>
                      <td className="px-4 py-2 text-muted-foreground">{entry.guest_email}</td>
                      <td className="px-4 py-2 text-muted-foreground">
                        {entry.invited_by ?? '—'}
                      </td>
                      <td className="px-4 py-2">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                            STATUS_BADGE[entry.status] ?? ''
                          }`}
                        >
                          {STATUS_LABEL[entry.status] ?? entry.status}
                        </span>
                        {entry.checked_in_at ? (
                          <p className="mt-0.5 text-[11px] text-muted-foreground">
                            {new Date(entry.checked_in_at).toLocaleString('cs-CZ')}
                          </p>
                        ) : null}
                      </td>
                      <td className="px-4 py-2 font-mono text-xs text-muted-foreground">
                        {entry.ticket_id ? entry.ticket_id.slice(0, 8) + '…' : '—'}
                      </td>
                      <td className="px-4 py-2">
                        {entry.status !== 'cancelled' && entry.status !== 'attended' ? (
                          <div className="flex gap-1">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => void checkIn(entry.id)}
                              disabled={busy === entry.id}
                            >
                              Check-in
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => void remove(entry.id, entry.guest_name)}
                              disabled={busy === entry.id}
                              className="text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                            >
                              Smazat
                            </Button>
                          </div>
                        ) : entry.status === 'attended' ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => void remove(entry.id, entry.guest_name)}
                            disabled={busy === entry.id}
                            className="text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                          >
                            Smazat
                          </Button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {entries.filter((e) => e.status === 'cancelled').length > 0 ? (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer py-1">
            Zrušené ({entries.filter((e) => e.status === 'cancelled').length})
          </summary>
          <div className="mt-2 space-y-1">
            {entries
              .filter((e) => e.status === 'cancelled')
              .map((entry) => (
                <div key={entry.id} className="rounded border bg-muted/20 px-3 py-1.5 line-through">
                  {entry.guest_name} — {entry.guest_email}
                </div>
              ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}
