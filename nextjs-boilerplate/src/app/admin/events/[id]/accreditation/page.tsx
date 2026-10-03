'use client';

import { useEffect, useState } from 'react';
import { useRouteParams } from '@/lib/next/route-params';
import { PageHeader } from '@/components/admin/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

interface AccreditationRequest {
  id: string;
  applicant_email: string;
  applicant_name: string;
  organization: string | null;
  category: string;
  role_detail: string | null;
  message: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  reviewed_at: string | null;
  rejection_reason: string | null;
  issued_ticket_id: string | null;
  created_at: string;
}

const CATEGORY_LABELS: Record<string, string> = {
  media: '📷 Média',
  vip: '👑 VIP',
  staff: '🛠 Staff',
  sponsor: '💼 Sponzor',
  performer: '🎤 Účinkující',
  guest: '🎟 Host',
};

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-900',
  approved: 'bg-emerald-100 text-emerald-900',
  rejected: 'bg-rose-100 text-rose-900',
  cancelled: 'bg-slate-100 text-slate-900',
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

export default function AccreditationAdminPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: eventId } = useRouteParams(params);
  const [requests, setRequests] = useState<AccreditationRequest[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [statusFilter, setStatusFilter] = useState<string>('pending');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  useEffect(() => {
    void load();
  }, [eventId, statusFilter]);

  async function load(): Promise<void> {
    try {
      const url = new URL(
        `/api/admin/events/${eventId}/accreditation`,
        window.location.origin,
      );
      if (statusFilter !== 'all') url.searchParams.set('status', statusFilter);
      const res = await authFetch(url.toString());
      if (!res.ok) {
        setError(`HTTP ${res.status}`);
        return;
      }
      const j = (await res.json()) as {
        requests: AccreditationRequest[];
        counts: Record<string, number>;
      };
      setRequests(j.requests);
      setCounts(j.counts);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function decide(
    reqId: string,
    action: 'approve' | 'reject' | 'cancel',
  ): Promise<void> {
    setBusy(reqId);
    setError(null);
    try {
      const res = await authFetch(
        `/api/admin/events/${eventId}/accreditation/${reqId}`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            action,
            rejectionReason: action === 'reject' ? rejectReason.trim() || undefined : undefined,
          }),
        },
      );
      const j = (await res.json().catch(() => ({}))) as {
        error?: string;
        issuedTicketId?: string | null;
      };
      if (!res.ok) {
        setError(j.error ?? `HTTP ${res.status}`);
        return;
      }
      if (action === 'approve' && !j.issuedTicketId) {
        setError(
          'Akreditace schválena, ale comp ticket NEVYSTAVEN — chybí ticket_type kind=accreditation v této akci. Vytvoř ho v Akcích → Ticket types.',
        );
      }
      setRejectReason('');
      setExpanded(null);
      await load();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Akreditace"
        description="Žádosti o akreditaci (média/VIP/staff/sponzor/účinkující). Po approve se automaticky vystaví comp ticket pokud existuje ticket_type kind='accreditation'."
      />

      <div className="flex flex-wrap items-center gap-2">
        {['pending', 'approved', 'rejected', 'cancelled', 'all'].map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStatusFilter(s)}
            className={`rounded-full border px-3 py-1 text-xs ${
              statusFilter === s
                ? 'bg-primary text-primary-foreground'
                : 'bg-card hover:bg-muted'
            }`}
          >
            {s === 'all' ? 'Všechny' : s}{' '}
            {s !== 'all' && counts[s] !== undefined ? `(${counts[s]})` : ''}
          </button>
        ))}
      </div>

      {error ? (
        <div className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">
          {error}
        </div>
      ) : null}

      {requests.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            Žádné žádosti v této kategorii.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {requests.map((r) => (
            <Card key={r.id}>
              <CardContent className="p-4">
                <div className="flex flex-wrap items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <strong>{r.applicant_name}</strong>
                      <span className="text-xs text-muted-foreground">
                        {r.applicant_email}
                      </span>
                      <span className="rounded-full bg-muted px-2 py-0.5 text-xs">
                        {CATEGORY_LABELS[r.category] ?? r.category}
                      </span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs ${STATUS_COLORS[r.status] ?? ''}`}
                      >
                        {r.status}
                      </span>
                    </div>
                    {r.organization ? (
                      <div className="mt-1 text-xs text-muted-foreground">
                        {r.organization}
                        {r.role_detail ? <> · {r.role_detail}</> : null}
                      </div>
                    ) : r.role_detail ? (
                      <div className="mt-1 text-xs text-muted-foreground">{r.role_detail}</div>
                    ) : null}
                    {r.message ? (
                      <p className="mt-2 rounded bg-muted/40 p-2 text-xs italic">{r.message}</p>
                    ) : null}
                    {r.rejection_reason ? (
                      <p className="mt-2 text-xs text-rose-700">
                        Důvod zamítnutí: {r.rejection_reason}
                      </p>
                    ) : null}
                    <p className="mt-2 text-[11px] text-muted-foreground">
                      Žádost {new Date(r.created_at).toLocaleString('cs-CZ')}
                      {r.reviewed_at
                        ? ` · vyřízeno ${new Date(r.reviewed_at).toLocaleString('cs-CZ')}`
                        : ''}
                      {r.issued_ticket_id
                        ? ` · 🎟 ticket ${r.issued_ticket_id.slice(0, 8)}`
                        : ''}
                    </p>
                  </div>
                  {r.status === 'pending' ? (
                    <div className="flex flex-col gap-1">
                      <Button
                        size="sm"
                        onClick={() => decide(r.id, 'approve')}
                        disabled={busy === r.id}
                      >
                        ✓ Schválit
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setExpanded(expanded === r.id ? null : r.id)}
                        disabled={busy === r.id}
                      >
                        ✗ Zamítnout
                      </Button>
                    </div>
                  ) : null}
                </div>
                {expanded === r.id ? (
                  <div className="mt-3 rounded-md border bg-rose-50 p-3">
                    <label className="mb-1 block text-xs font-medium text-rose-900">
                      Důvod zamítnutí (volitelné, pošle se aplikantovi)
                    </label>
                    <textarea
                      value={rejectReason}
                      onChange={(e) => setRejectReason(e.target.value)}
                      rows={2}
                      maxLength={500}
                      className="w-full rounded border bg-white p-2 text-xs"
                      placeholder="Důvod…"
                    />
                    <div className="mt-2 flex gap-2">
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => decide(r.id, 'reject')}
                        disabled={busy === r.id}
                      >
                        {busy === r.id ? 'Odesílám…' : 'Potvrdit zamítnutí'}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setExpanded(null)}
                      >
                        Zpět
                      </Button>
                    </div>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
