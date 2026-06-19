'use client';

import { use, useEffect, useState } from 'react';
import { PageHeader } from '@/components/admin/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface PressAccreditation {
  id: string;
  journalist_name: string;
  journalist_email: string;
  media_outlet: string;
  purpose: string | null;
  status: 'pending' | 'approved' | 'rejected';
  rejection_reason: string | null;
  ticket_id: string | null;
  order_id: string | null;
  created_at: string;
  updated_at: string;
}

interface PressSettings {
  press_seats_max: number;
  press_deadline: string | null;
}

interface Counts {
  approved: number;
  pending: number;
  total: number;
}

const STATUS_BADGE: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-800',
  approved: 'bg-emerald-100 text-emerald-800',
  rejected: 'bg-rose-100 text-rose-800',
};

const STATUS_LABEL: Record<string, string> = {
  pending: 'Čeká',
  approved: 'Schváleno',
  rejected: 'Zamítnuto',
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

function toDatetimeLocal(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function PressPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: eventId } = use(params);

  const [accreditations, setAccreditations] = useState<PressAccreditation[]>([]);
  const [settings, setSettings] = useState<PressSettings>({ press_seats_max: 0, press_deadline: null });
  const [counts, setCounts] = useState<Counts>({ approved: 0, pending: 0, total: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [seatsMax, setSeatsMax] = useState('0');
  const [deadline, setDeadline] = useState('');
  const [savingSettings, setSavingSettings] = useState(false);

  const [busy, setBusy] = useState<string | null>(null);

  const [rejectModal, setRejectModal] = useState<{ id: string; name: string } | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectBusy, setRejectBusy] = useState(false);

  useEffect(() => {
    void load();
  }, [eventId]);

  async function load(): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const res = await authFetch(`/api/admin/events/${eventId}/press`);
      if (!res.ok) {
        setError(`HTTP ${res.status}`);
        return;
      }
      const j = (await res.json()) as {
        accreditations: PressAccreditation[];
        settings: PressSettings;
        counts: Counts;
      };
      setAccreditations(j.accreditations);
      setSettings(j.settings);
      setCounts(j.counts);
      setSeatsMax(String(j.settings.press_seats_max));
      setDeadline(toDatetimeLocal(j.settings.press_deadline));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function saveSettings(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setSavingSettings(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await authFetch(`/api/admin/events/${eventId}/press/settings`, {
        method: 'PATCH',
        body: JSON.stringify({
          pressSeatsMax: parseInt(seatsMax, 10) || 0,
          pressDeadline: deadline ? new Date(deadline).toISOString() : null,
        }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(j.error ?? `HTTP ${res.status}`);
        return;
      }
      setSuccess('Nastavení uloženo.');
      await load();
    } finally {
      setSavingSettings(false);
    }
  }

  async function approve(accId: string, name: string): Promise<void> {
    setBusy(accId);
    setError(null);
    setSuccess(null);
    try {
      const res = await authFetch(`/api/admin/events/${eventId}/press`, {
        method: 'PATCH',
        body: JSON.stringify({ accreditationId: accId, status: 'approved' }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(j.error ?? `HTTP ${res.status}`);
        return;
      }
      setSuccess(`Akreditace pro ${name} schválena, vstupenka vystavena.`);
      await load();
    } finally {
      setBusy(null);
    }
  }

  async function confirmReject(): Promise<void> {
    if (!rejectModal) return;
    setRejectBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await authFetch(`/api/admin/events/${eventId}/press`, {
        method: 'PATCH',
        body: JSON.stringify({
          accreditationId: rejectModal.id,
          status: 'rejected',
          rejectionReason: rejectReason.trim() || undefined,
        }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(j.error ?? `HTTP ${res.status}`);
        return;
      }
      setSuccess(`Akreditace pro ${rejectModal.name} zamítnuta.`);
      setRejectModal(null);
      setRejectReason('');
      await load();
    } finally {
      setRejectBusy(false);
    }
  }

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Press akreditace"
        description={`${counts.approved} schváleno / ${counts.pending} čeká / ${settings.press_seats_max > 0 ? settings.press_seats_max : '∞'} press míst celkem`}
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
        <CardHeader>
          <CardTitle className="text-base">Nastavení</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={(e) => void saveSettings(e)} className="flex flex-wrap items-end gap-4">
            <div>
              <label className="mb-1 block text-xs font-medium">Počet press míst</label>
              <Input
                type="number"
                min={0}
                value={seatsMax}
                onChange={(e) => setSeatsMax(e.target.value)}
                className="w-28"
              />
              <p className="mt-0.5 text-[11px] text-muted-foreground">0 = neomezeno</p>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Deadline pro žádosti</label>
              <Input
                type="datetime-local"
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
                className="w-52"
              />
            </div>
            <Button type="submit" disabled={savingSettings}>
              {savingSettings ? 'Ukládám…' : 'Uložit nastavení'}
            </Button>
          </form>
        </CardContent>
      </Card>

      {loading ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            Načítám...
          </CardContent>
        </Card>
      ) : accreditations.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            Žádné žádosti o akreditaci zatím nebyly podány.
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
                    <th className="px-4 py-2 text-left font-medium">Médium</th>
                    <th className="px-4 py-2 text-left font-medium">Email</th>
                    <th className="px-4 py-2 text-left font-medium">Status</th>
                    <th className="px-4 py-2 text-left font-medium">Ticket</th>
                    <th className="px-4 py-2 text-left font-medium">Akce</th>
                  </tr>
                </thead>
                <tbody>
                  {accreditations.map((acc) => (
                    <tr key={acc.id} className="border-b last:border-0 hover:bg-muted/20">
                      <td className="px-4 py-2 font-medium">
                        {acc.journalist_name}
                        {acc.purpose ? (
                          <p className="text-[11px] text-muted-foreground">{acc.purpose}</p>
                        ) : null}
                      </td>
                      <td className="px-4 py-2">{acc.media_outlet}</td>
                      <td className="px-4 py-2 text-muted-foreground">{acc.journalist_email}</td>
                      <td className="px-4 py-2">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                            STATUS_BADGE[acc.status] ?? ''
                          }`}
                        >
                          {STATUS_LABEL[acc.status] ?? acc.status}
                        </span>
                        {acc.status === 'rejected' && acc.rejection_reason ? (
                          <p className="mt-0.5 text-[11px] text-muted-foreground">
                            {acc.rejection_reason}
                          </p>
                        ) : null}
                      </td>
                      <td className="px-4 py-2 font-mono text-xs text-muted-foreground">
                        {acc.ticket_id ? acc.ticket_id.slice(0, 8) + '…' : '—'}
                      </td>
                      <td className="px-4 py-2">
                        {acc.status === 'pending' ? (
                          <div className="flex gap-1">
                            <Button
                              size="sm"
                              onClick={() => void approve(acc.id, acc.journalist_name)}
                              disabled={busy === acc.id}
                            >
                              Schválit
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setRejectModal({ id: acc.id, name: acc.journalist_name });
                                setRejectReason('');
                              }}
                              disabled={busy === acc.id}
                              className="text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                            >
                              Zamítnout
                            </Button>
                          </div>
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

      {rejectModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md rounded-lg border bg-card p-6 shadow-xl">
            <h2 className="mb-4 text-lg font-semibold">Zamítnout akreditaci</h2>
            <p className="mb-3 text-sm text-muted-foreground">
              Zamítnutí žádosti: <strong>{rejectModal.name}</strong>
            </p>
            <label className="mb-1 block text-sm font-medium">Důvod zamítnutí (volitelný)</label>
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              rows={3}
              maxLength={500}
              placeholder="Kapacita vyčerpána, duplicitní žádost..."
              className="mb-4 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setRejectModal(null);
                  setRejectReason('');
                }}
                disabled={rejectBusy}
              >
                Zrušit
              </Button>
              <Button
                variant="destructive"
                onClick={() => void confirmReject()}
                disabled={rejectBusy}
              >
                {rejectBusy ? 'Zamítám…' : 'Zamítnout'}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
