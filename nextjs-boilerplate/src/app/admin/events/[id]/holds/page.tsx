'use client';

import { use, useEffect, useState } from 'react';
import { PageHeader } from '@/components/admin/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

interface HoldRow {
  seatId: string;
  sector: string;
  row: string;
  seatNumber: string;
  kind: 'artist' | 'promoter' | 'comp' | 'production';
  label: string | null;
  releaseAt: string | null;
}

type Kind = 'artist' | 'promoter' | 'comp' | 'production';

const KIND_LABELS: Record<Kind, string> = {
  artist: '🎤 Artist hold',
  promoter: '👤 Promoter hold',
  comp: '🎁 Comp ticket',
  production: '🔧 Production kill',
};

const KIND_COLORS: Record<Kind, string> = {
  artist: 'bg-purple-100 text-purple-900 border-purple-300',
  promoter: 'bg-blue-100 text-blue-900 border-blue-300',
  comp: 'bg-emerald-100 text-emerald-900 border-emerald-300',
  production: 'bg-slate-100 text-slate-900 border-slate-300',
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

export default function HoldsAdminPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: eventId } = use(params);
  const [holds, setHolds] = useState<HoldRow[]>([]);
  const [totals, setTotals] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Form state
  const [seatIdsRaw, setSeatIdsRaw] = useState('');
  const [kind, setKind] = useState<Kind>('artist');
  const [label, setLabel] = useState('');
  const [releaseAt, setReleaseAt] = useState('');

  useEffect(() => {
    void load();
  }, [eventId]);

  async function load(): Promise<void> {
    try {
      const res = await authFetch(`/api/admin/events/${eventId}/holds`);
      if (!res.ok) {
        setError(`HTTP ${res.status}`);
        return;
      }
      const j = (await res.json()) as { holds: HoldRow[]; totalsByKind: Record<string, number> };
      setHolds(j.holds);
      setTotals(j.totalsByKind);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function parseSeatIds(raw: string): string[] {
    return raw
      .split(/[\s,;\n]+/)
      .map((s) => s.trim())
      .filter((s) => /^[0-9a-f-]{36}$/i.test(s));
  }

  async function createHolds(): Promise<void> {
    const seatIds = parseSeatIds(seatIdsRaw);
    if (seatIds.length === 0) {
      setError('Žádný platný seat ID (musí být UUID).');
      return;
    }
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await authFetch(`/api/admin/events/${eventId}/holds`, {
        method: 'POST',
        body: JSON.stringify({
          seatIds,
          kind,
          label: label.trim() || undefined,
          releaseAt: releaseAt ? new Date(releaseAt).toISOString() : undefined,
        }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        held?: number;
        requested?: number;
        skipped?: number;
        error?: string;
      };
      if (!res.ok || !j.ok) {
        setError(j.error ?? `HTTP ${res.status}`);
        return;
      }
      setSuccess(
        `Zablokováno ${j.held}/${j.requested} sedadel (${j.skipped} přeskočeno — nejsou available nebo už drží jiný kind).`,
      );
      setSeatIdsRaw('');
      setLabel('');
      setReleaseAt('');
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function releaseKind(kindToRelease: Kind): Promise<void> {
    if (!confirm(`Opravdu uvolnit všech ${totals[kindToRelease] ?? 0} sedadel kindu „${KIND_LABELS[kindToRelease]}"?`)) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await authFetch(`/api/admin/events/${eventId}/holds`, {
        method: 'DELETE',
        body: JSON.stringify({ kind: kindToRelease }),
      });
      const j = (await res.json().catch(() => ({}))) as { released?: number; error?: string };
      if (!res.ok) {
        setError(j.error ?? `HTTP ${res.status}`);
        return;
      }
      setSuccess(`Uvolněno ${j.released} sedadel.`);
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function releaseSingle(seatId: string): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const res = await authFetch(`/api/admin/events/${eventId}/holds`, {
        method: 'DELETE',
        body: JSON.stringify({ seatIds: [seatId] }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setError(j.error ?? `HTTP ${res.status}`);
        return;
      }
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Holds & Kills"
        description="Blokování sedadel pro umělce, VIP hosty, comp tickety nebo technické pozice (production kills). Nezasahuje do běžných buyer holds."
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {(['artist', 'promoter', 'comp', 'production'] as Kind[]).map((k) => (
          <div key={k} className={`rounded-md border p-3 ${KIND_COLORS[k]}`}>
            <div className="text-xs uppercase opacity-70">{KIND_LABELS[k]}</div>
            <div className="mt-1 flex items-baseline justify-between gap-2">
              <span className="text-2xl font-bold tabular-nums">{totals[k] ?? 0}</span>
              {(totals[k] ?? 0) > 0 ? (
                <button
                  type="button"
                  onClick={() => releaseKind(k)}
                  disabled={busy}
                  className="text-xs opacity-70 hover:underline"
                >
                  Uvolnit všechny
                </button>
              ) : null}
            </div>
          </div>
        ))}
      </div>

      <Card>
        <CardContent className="space-y-3 p-4">
          <h2 className="text-sm font-semibold">Nová blokace</h2>
          <div>
            <label className="mb-1 block text-xs font-medium">
              Seat IDs (UUID, odděl mezerou, čárkou nebo Enter)
            </label>
            <textarea
              value={seatIdsRaw}
              onChange={(e) => setSeatIdsRaw(e.target.value)}
              rows={4}
              className="w-full rounded-md border bg-background p-2 font-mono text-xs"
              placeholder="00000000-0000-0000-0000-000000000001 00000000-..."
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              {parseSeatIds(seatIdsRaw).length} platných UUID rozpoznáno
            </p>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs font-medium">Kind</label>
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value as Kind)}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              >
                {(Object.keys(KIND_LABELS) as Kind[]).map((k) => (
                  <option key={k} value={k}>
                    {KIND_LABELS[k]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Label (volitelné)</label>
              <Input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                maxLength={120}
                placeholder="např. Manager, Soutěž rádio…"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Auto-release</label>
              <Input
                type="datetime-local"
                value={releaseAt}
                onChange={(e) => setReleaseAt(e.target.value)}
              />
            </div>
          </div>
          <Button onClick={createHolds} disabled={busy || parseSeatIds(seatIdsRaw).length === 0}>
            {busy ? 'Zpracovávám…' : 'Zablokovat'}
          </Button>
        </CardContent>
      </Card>

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

      {holds.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            Žádné aktivní hold-y mimo customer buyer holds.
          </CardContent>
        </Card>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs uppercase">
              <tr>
                <th className="px-3 py-2">Sektor</th>
                <th className="px-3 py-2">Řada</th>
                <th className="px-3 py-2">Místo</th>
                <th className="px-3 py-2">Kind</th>
                <th className="px-3 py-2">Label</th>
                <th className="px-3 py-2">Auto-release</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {holds.map((h) => (
                <tr key={h.seatId} className="border-t text-xs">
                  <td className="px-3 py-2">{h.sector}</td>
                  <td className="px-3 py-2">{h.row}</td>
                  <td className="px-3 py-2">{h.seatNumber}</td>
                  <td className="px-3 py-2">
                    <span className={`rounded-full px-2 py-0.5 ${KIND_COLORS[h.kind]}`}>
                      {KIND_LABELS[h.kind]}
                    </span>
                  </td>
                  <td className="px-3 py-2">{h.label ?? '—'}</td>
                  <td className="px-3 py-2">
                    {h.releaseAt ? new Date(h.releaseAt).toLocaleString('cs-CZ') : '—'}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => releaseSingle(h.seatId)}
                      disabled={busy}
                      className="text-rose-700 hover:underline"
                    >
                      Uvolnit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
