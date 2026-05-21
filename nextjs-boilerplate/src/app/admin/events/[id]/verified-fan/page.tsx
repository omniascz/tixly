'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { CheckCircle2, XCircle, Star } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { PageHeader } from '@/components/admin/PageHeader';
import { typedGet, typedPost, TypedFetchError } from '@/lib/typed-fetch';

interface FanRequest {
  id: string;
  user_id: string;
  user_email: string;
  user_name: string;
  status: 'pending' | 'approved' | 'rejected';
  presale_code: string | null;
  approved_at: string | null;
  rejected_reason: string | null;
  fan_motivation: string | null;
  user_age_days: number | null;
  email_domain: string | null;
  used_at: string | null;
  created_at: string;
}

interface EventInfo {
  title: string;
  verified_fan_enabled: boolean;
  presale_starts_at: string | null;
  presale_ends_at: string | null;
}

export default function VerifiedFanAdminPage() {
  const params = useParams<{ id: string }>();
  const eventId = params.id;
  const [event, setEvent] = useState<EventInfo | null>(null);
  const [requests, setRequests] = useState<FanRequest[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('pending');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    void load();
  }, [eventId]);

  async function load() {
    try {
      const data = await typedGet<{
        event: EventInfo;
        requests: FanRequest[];
      }>(`/api/admin/events/${eventId}/verified-fan`);
      setEvent(data.event);
      setRequests(data.requests ?? []);
    } catch {
      setError('Nelze načíst — chyba serveru nebo nemáš oprávnění.');
    }
  }

  const filtered = filter === 'all'
    ? requests
    : requests.filter((r) => r.status === filter);

  const stats = {
    pending: requests.filter((r) => r.status === 'pending').length,
    approved: requests.filter((r) => r.status === 'approved').length,
    rejected: requests.filter((r) => r.status === 'rejected').length,
    used: requests.filter((r) => r.used_at !== null).length,
  };

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAllVisible() {
    setSelectedIds(new Set(filtered.map((r) => r.id)));
  }

  function clearSelection() {
    setSelectedIds(new Set());
  }

  async function bulkAction(action: 'approve' | 'reject') {
    if (selectedIds.size === 0) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await typedPost<{ processed: number }>(
        `/api/admin/events/${eventId}/verified-fan/bulk`,
        {
          ids: Array.from(selectedIds),
          action,
          reason: action === 'reject' ? 'Selected for rejection' : undefined,
        },
        { throwOnError: true },
      );
      setSuccess(`${res.processed} žádostí ${action === 'approve' ? 'schváleno' : 'odmítnuto'}.`);
      setSelectedIds(new Set());
      await load();
    } catch (err) {
      if (err instanceof TypedFetchError) {
        setError(`HTTP ${err.status}`);
      } else {
        setError('Síťová chyba');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Verified Fan registrace"
        description={event ? event.title : 'Načítám…'}
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

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs uppercase text-muted-foreground">Čekající</p>
            <p className="mt-1 text-2xl font-bold tabular-nums">{stats.pending}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs uppercase text-muted-foreground">Schváleno</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-emerald-700">
              {stats.approved}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs uppercase text-muted-foreground">Odmítnuto</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-rose-700">
              {stats.rejected}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs uppercase text-muted-foreground">Použito kódů</p>
            <p className="mt-1 text-2xl font-bold tabular-nums">{stats.used}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Žádosti ({filtered.length})</CardTitle>
          <CardDescription>
            Vyber fanoušky → schválit hromadně. Approved dostanou unikátní kód emailem.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <div className="flex gap-1">
              {(['pending', 'approved', 'rejected', 'all'] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFilter(f)}
                  className={`rounded-md border px-3 py-1 text-xs ${
                    filter === f
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'hover:bg-muted/40'
                  }`}
                >
                  {f === 'pending' ? 'Čekající' :
                   f === 'approved' ? 'Schváleno' :
                   f === 'rejected' ? 'Odmítnuto' : 'Vše'}
                </button>
              ))}
            </div>
            <div className="ml-auto flex gap-2">
              {selectedIds.size > 0 ? (
                <>
                  <span className="self-center text-xs text-muted-foreground">
                    {selectedIds.size} vybráno
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={clearSelection}
                    disabled={busy}
                  >
                    Zrušit výběr
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => void bulkAction('approve')}
                    disabled={busy}
                    className="bg-emerald-600 text-white hover:bg-emerald-700"
                  >
                    <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
                    Schválit
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void bulkAction('reject')}
                    disabled={busy}
                  >
                    <XCircle className="mr-1 h-3.5 w-3.5" />
                    Odmítnout
                  </Button>
                </>
              ) : (
                <Button size="sm" variant="outline" onClick={selectAllVisible}>
                  Vybrat vše
                </Button>
              )}
            </div>
          </div>

          {filtered.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              <Star className="mx-auto mb-2 h-8 w-8 opacity-50" />
              Žádné žádosti pro tento filter.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                  <th className="py-2 w-8"></th>
                  <th>User</th>
                  <th>Email</th>
                  <th>Účet</th>
                  <th>Motivace</th>
                  <th>Stav</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.id} className="border-b hover:bg-muted/30">
                    <td className="py-2">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(r.id)}
                        onChange={() => toggleSelect(r.id)}
                        disabled={r.status !== 'pending'}
                      />
                    </td>
                    <td>{r.user_name}</td>
                    <td className="text-xs">{r.user_email}</td>
                    <td className="text-xs">
                      {r.user_age_days !== null ? `${r.user_age_days} dní` : '—'}
                      {r.email_domain ? ` · ${r.email_domain}` : ''}
                    </td>
                    <td className="max-w-xs truncate text-xs italic text-muted-foreground">
                      {r.fan_motivation ?? '—'}
                    </td>
                    <td>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          r.status === 'approved'
                            ? 'bg-emerald-100 text-emerald-900'
                            : r.status === 'rejected'
                              ? 'bg-rose-100 text-rose-900'
                              : 'bg-amber-100 text-amber-900'
                        }`}
                      >
                        {r.status === 'pending' ? 'čeká' : r.status === 'approved' ? 'OK' : 'odmítnuto'}
                      </span>
                      {r.used_at ? (
                        <span className="ml-1 text-[11px] text-muted-foreground">(použito)</span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
