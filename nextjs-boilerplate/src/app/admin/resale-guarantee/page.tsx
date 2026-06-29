'use client';

import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/admin/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface Claim {
  id: string;
  resale_listing_id: string;
  buyer_order_id: string;
  reporter_user_id: string | null;
  reason: string;
  status: string;
  resolution: string | null;
  resolved_at: string | null;
  refund_amount_halire: number | null;
  created_at: string;
  reporter_email: string | null;
  event_title: string | null;
}

function statusBadge(status: string): string {
  switch (status) {
    case 'pending': return 'bg-amber-100 text-amber-900';
    case 'approved': return 'bg-green-100 text-green-900';
    case 'rejected': return 'bg-rose-100 text-rose-900';
    default: return 'bg-gray-100 text-gray-700';
  }
}

function authHeaders() {
  const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export default function ResaleGuaranteePage() {
  const [claims, setClaims] = useState<Claim[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [resolveModal, setResolveModal] = useState<Claim | null>(null);
  const [resStatus, setResStatus] = useState<'approved' | 'rejected'>('approved');
  const [resResolution, setResResolution] = useState('');
  const [resRefund, setResRefund] = useState('');
  const [resError, setResError] = useState<string | null>(null);
  const [resSaving, setResSaving] = useState(false);
  const [filterStatus, setFilterStatus] = useState('');

  async function load() {
    setLoading(true);
    try {
      const qs = filterStatus ? `?status=${encodeURIComponent(filterStatus)}` : '';
      const res = await fetch(`/api/admin/resale-guarantee${qs}`, {
        headers: authHeaders(),
      });
      if (!res.ok) return;
      const d = (await res.json()) as { claims: Claim[]; total: number };
      setClaims(d.claims ?? []);
      setTotal(d.total ?? 0);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [filterStatus]);

  async function handleResolve() {
    if (!resolveModal) return;
    setResSaving(true);
    setResError(null);
    try {
      const res = await fetch('/api/admin/resale-guarantee', {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify({
          id: resolveModal.id,
          status: resStatus,
          resolution: resResolution.trim() || undefined,
          refundAmountHalire: resRefund ? parseInt(resRefund, 10) * 100 : undefined,
        }),
      });
      const d = await res.json();
      if (!res.ok) {
        setResError(d.message ?? d.error ?? `HTTP ${res.status}`);
        return;
      }
      setResolveModal(null);
      setResResolution('');
      setResRefund('');
      await load();
    } finally {
      setResSaving(false);
    }
  }

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Fan Guarantee — Resale claims"
        description="Správa reklamací záruky autenticity resale vstupenek."
      />

      <div className="flex gap-3 items-center">
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="rounded-md border px-3 py-2 text-sm"
        >
          <option value="">Všechny stavy</option>
          <option value="pending">Čeká na vyřízení</option>
          <option value="approved">Schváleno</option>
          <option value="rejected">Zamítnuto</option>
        </select>
        <span className="text-sm text-muted-foreground">Celkem: {total}</span>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          {loading ? 'Načítám…' : 'Obnovit'}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Claimy ({claims.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Akce</th>
                  <th className="px-4 py-2 text-left font-medium">Nahlásil</th>
                  <th className="px-4 py-2 text-left font-medium">Stav</th>
                  <th className="px-4 py-2 text-left font-medium">Důvod</th>
                  <th className="px-4 py-2 text-left font-medium">Vytvořeno</th>
                  <th className="px-4 py-2 text-left font-medium">Akce</th>
                </tr>
              </thead>
              <tbody>
                {claims.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">
                      Žádné claimy.
                    </td>
                  </tr>
                ) : null}
                {claims.map((c) => (
                  <tr key={c.id} className="border-b hover:bg-muted/20">
                    <td className="px-4 py-2">
                      {c.event_title ?? '—'}
                      <div className="text-xs text-muted-foreground font-mono">
                        {c.buyer_order_id.slice(0, 8)}
                      </div>
                    </td>
                    <td className="px-4 py-2">
                      {c.reporter_email ?? c.reporter_user_id?.slice(0, 8) ?? '—'}
                    </td>
                    <td className="px-4 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusBadge(c.status)}`}>
                        {c.status}
                      </span>
                    </td>
                    <td className="px-4 py-2 max-w-xs">
                      <span className="line-clamp-2 text-xs">{c.reason}</span>
                    </td>
                    <td className="px-4 py-2 text-xs">
                      {new Date(c.created_at).toLocaleDateString('cs-CZ')}
                    </td>
                    <td className="px-4 py-2">
                      {c.status === 'pending' ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setResolveModal(c);
                            setResStatus('approved');
                            setResResolution('');
                            setResRefund('');
                            setResError(null);
                          }}
                        >
                          Vyřešit
                        </Button>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          {c.resolution ?? '—'}
                          {c.refund_amount_halire
                            ? ` · refund ${(c.refund_amount_halire / 100).toLocaleString('cs-CZ')} Kč`
                            : ''}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Resolve modal */}
      {resolveModal ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => setResolveModal(null)}
        >
          <div
            className="w-full max-w-md rounded-lg bg-background p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="mb-4 text-lg font-semibold">Vyřešit claim</h2>
            <p className="mb-3 text-sm text-muted-foreground">
              Claim: <span className="font-mono">{resolveModal.id.slice(0, 8)}</span>
            </p>
            <p className="mb-4 text-sm">{resolveModal.reason}</p>

            <div className="mb-3">
              <label className="mb-1 block text-xs font-medium">Výsledek *</label>
              <select
                value={resStatus}
                onChange={(e) => setResStatus(e.target.value as 'approved' | 'rejected')}
                className="w-full rounded-md border px-3 py-2 text-sm"
              >
                <option value="approved">Schválit (vrátit peníze)</option>
                <option value="rejected">Zamítnout</option>
              </select>
            </div>

            <div className="mb-3">
              <label className="mb-1 block text-xs font-medium">Rozhodnutí / poznámka</label>
              <textarea
                value={resResolution}
                onChange={(e) => setResResolution(e.target.value)}
                rows={3}
                className="w-full rounded-md border px-3 py-2 text-sm"
                placeholder="Výsledek šetření…"
              />
            </div>

            {resStatus === 'approved' ? (
              <div className="mb-3">
                <label className="mb-1 block text-xs font-medium">Výše refundu (Kč)</label>
                <input
                  type="number"
                  min={0}
                  value={resRefund}
                  onChange={(e) => setResRefund(e.target.value)}
                  className="w-full rounded-md border px-3 py-2 text-sm"
                  placeholder="0"
                />
              </div>
            ) : null}

            {resError ? (
              <p className="mb-3 text-sm text-destructive">{resError}</p>
            ) : null}

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setResolveModal(null)}>
                Zrušit
              </Button>
              <Button onClick={handleResolve} disabled={resSaving}>
                {resSaving ? 'Ukládám…' : 'Potvrdit'}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
