'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface Version {
  id: string;
  name: string;
  total_seats: number;
  active: boolean;
  created_at: string;
  created_by_user_id: string | null;
  created_by_email: string | null;
  notes: string | null;
  source: string | null;
  version: number;
}

interface DiffSeatChange {
  sector: string;
  row: string;
  num: string;
  kind: 'added' | 'removed' | 'moved' | 'accessibility-changed';
  from?: { x: number; y: number };
  to?: { x: number; y: number };
}

interface DiffPayload {
  from: { id: string; name: string; createdAt: string };
  to: { id: string; name: string; createdAt: string };
  diff: {
    identical: boolean;
    totals: {
      fromSeats: number;
      toSeats: number;
      added: number;
      removed: number;
      moved: number;
      accessibilityChanged: number;
    };
    sectors: {
      added: string[];
      removed: string[];
      renamed: { from: string; to: string }[];
      rowsByDelta: { name: string; rowDelta: number; seatDelta: number }[];
    };
    viewBoxChanged: boolean;
    fromViewBox: string;
    toViewBox: string;
    sample: DiffSeatChange[];
  };
}

const SOURCE_LABELS: Record<string, string> = {
  editor: 'Visual editor',
  grid: 'Grid builder',
  json: 'JSON paste',
  csv: 'CSV import',
  svg: 'SVG import',
  restore: 'Restored',
};

export default function PlatformVenueVersionsPage({
  params,
}: {
  params: { id: string };
}) {
  const venueId = params.id;
  const [versions, setVersions] = useState<Version[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [fromId, setFromId] = useState<string | null>(null);
  const [toId, setToId] = useState<string | null>(null);
  const [diff, setDiff] = useState<DiffPayload | null>(null);
  const [diffBusy, setDiffBusy] = useState(false);

  async function load() {
    setError(null);
    try {
      const res = await fetch(`/api/platform/venues/${venueId}/seating-chart/versions`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = (await res.json()) as { versions: Version[] };
      setVersions(j.versions);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => { void load(); }, [venueId]);

  const active = useMemo(() => versions.find((v) => v.active), [versions]);

  async function restore(v: Version) {
    if (!confirm(
      `Obnovit verzi v${v.version} (${v.total_seats} sedadel)? Vytvoří se nová aktivní verze` +
      ` z této historie. Aktuální layout zůstane v historii.`,
    )) return;
    setBusyId(v.id);
    try {
      const res = await fetch(
        `/api/platform/venues/${venueId}/seating-chart/versions/${v.id}/restore`,
        { method: 'POST' },
      );
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(j.error ?? `HTTP ${res.status}`);
        return;
      }
      await load();
    } finally {
      setBusyId(null);
    }
  }

  async function runDiff() {
    if (!fromId || !toId || fromId === toId) {
      setError('Vyber dvě různé verze pro diff.');
      return;
    }
    setDiffBusy(true);
    setError(null);
    setDiff(null);
    try {
      const res = await fetch(
        `/api/platform/venues/${venueId}/seating-chart/diff?from=${fromId}&to=${toId}`,
      );
      const j = (await res.json().catch(() => ({}))) as DiffPayload | { error?: string };
      if (!res.ok) {
        setError(('error' in j && j.error) || `HTTP ${res.status}`);
        return;
      }
      setDiff(j as DiffPayload);
    } finally {
      setDiffBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/platform/venues/${venueId}/edit`} className="text-sm text-primary hover:underline">
          ← Zpět na detail sálu
        </Link>
        <h1 className="mt-1 text-2xl font-bold">📜 Historie verzí</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Každý uložený layout = nová verze. Stará nikdy nemizí — diff a restore kdykoliv.
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">
          {error}
        </div>
      )}

      {versions.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            Pro tento sál ještě nebyla uložena žádná verze.
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Diff dvou verzí</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <div>
                  <label className="mb-1 block text-xs uppercase text-muted-foreground">Z verze</label>
                  <select
                    value={fromId ?? ''}
                    onChange={(e) => setFromId(e.target.value || null)}
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                  >
                    <option value="">— vyber —</option>
                    {versions.map((v) => (
                      <option key={v.id} value={v.id}>
                        v{v.version} · {new Date(v.created_at).toLocaleDateString('cs-CZ')} · {v.total_seats} seats
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs uppercase text-muted-foreground">Do verze</label>
                  <select
                    value={toId ?? ''}
                    onChange={(e) => setToId(e.target.value || null)}
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                  >
                    <option value="">— vyber —</option>
                    {versions.map((v) => (
                      <option key={v.id} value={v.id}>
                        v{v.version} · {new Date(v.created_at).toLocaleDateString('cs-CZ')} · {v.total_seats} seats
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex items-end">
                  <Button onClick={runDiff} disabled={diffBusy || !fromId || !toId} className="w-full">
                    {diffBusy ? 'Počítám diff…' : 'Spočítat diff'}
                  </Button>
                </div>
              </div>

              {diff && <DiffPanel diff={diff} />}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Verze ({versions.length})</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                    <th className="py-2">Verze</th>
                    <th>Název</th>
                    <th>Zdroj</th>
                    <th className="text-right">Sedadel</th>
                    <th>Vytvořil</th>
                    <th>Datum</th>
                    <th>Notes</th>
                    <th className="text-right">Akce</th>
                  </tr>
                </thead>
                <tbody>
                  {versions.map((v) => (
                    <tr key={v.id} className={`border-b ${v.active ? 'bg-emerald-50/40' : ''}`}>
                      <td className="py-2">
                        <span className="font-mono">v{v.version}</span>
                        {v.active && (
                          <span className="ml-2 rounded bg-emerald-100 px-1.5 py-0.5 text-xs text-emerald-800">
                            ✓ aktivní
                          </span>
                        )}
                      </td>
                      <td className="font-medium">{v.name}</td>
                      <td>
                        <code className="rounded bg-muted px-1 text-xs">
                          {v.source ? SOURCE_LABELS[v.source] ?? v.source : '—'}
                        </code>
                      </td>
                      <td className="text-right tabular-nums">{v.total_seats.toLocaleString('cs-CZ')}</td>
                      <td className="text-xs">{v.created_by_email ?? '—'}</td>
                      <td className="text-xs text-muted-foreground">
                        {new Date(v.created_at).toLocaleString('cs-CZ')}
                      </td>
                      <td className="max-w-xs text-xs text-muted-foreground">{v.notes ?? ''}</td>
                      <td className="text-right">
                        {!v.active && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => restore(v)}
                            disabled={busyId === v.id}
                          >
                            {busyId === v.id ? '…' : '↺ Restore'}
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {active && (
                <p className="mt-3 text-xs text-muted-foreground">
                  Aktivní verze v{active.version} se nyní používá pro vytváření akcí.
                </p>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function DiffPanel({ diff }: { diff: DiffPayload }) {
  if (diff.diff.identical) {
    return (
      <div className="mt-4 rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">
        ✓ Verze jsou identické — žádný rozdíl.
      </div>
    );
  }
  const t = diff.diff.totals;
  return (
    <div className="mt-4 space-y-3">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
        <DiffStat label="Z" value={t.fromSeats} />
        <DiffStat label="Do" value={t.toSeats} />
        <DiffStat label="+ přidáno" value={t.added} tone="emerald" />
        <DiffStat label="− odebráno" value={t.removed} tone="rose" />
        <DiffStat label="↔ posunuto" value={t.moved} tone="amber" />
      </div>

      {(diff.diff.sectors.added.length > 0
        || diff.diff.sectors.removed.length > 0
        || diff.diff.sectors.renamed.length > 0
        || diff.diff.sectors.rowsByDelta.length > 0) && (
        <div className="rounded-md border bg-muted/30 p-3 text-xs">
          <div className="font-medium uppercase text-muted-foreground">Sektor-level changes</div>
          <ul className="mt-2 space-y-0.5">
            {diff.diff.sectors.added.map((s) => (
              <li key={`add-${s}`} className="text-emerald-800">+ Nový sektor: <strong>{s}</strong></li>
            ))}
            {diff.diff.sectors.removed.map((s) => (
              <li key={`rm-${s}`} className="text-rose-800">− Smazán sektor: <strong>{s}</strong></li>
            ))}
            {diff.diff.sectors.renamed.map((r) => (
              <li key={`ren-${r.from}-${r.to}`} className="text-amber-800">
                ✎ Přejmenován: <strong>{r.from}</strong> → <strong>{r.to}</strong>
              </li>
            ))}
            {diff.diff.sectors.rowsByDelta.map((r) => (
              <li key={`d-${r.name}`}>
                <strong>{r.name}</strong>: {r.rowDelta >= 0 ? '+' : ''}{r.rowDelta} řad,
                {' '}{r.seatDelta >= 0 ? '+' : ''}{r.seatDelta} seats
              </li>
            ))}
          </ul>
        </div>
      )}

      {diff.diff.viewBoxChanged && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
          ⚠ ViewBox změněn: <code>{diff.diff.fromViewBox}</code> → <code>{diff.diff.toViewBox}</code>
        </div>
      )}

      {diff.diff.sample.length > 0 && (
        <details>
          <summary className="cursor-pointer text-xs text-muted-foreground">
            Sample změn ({diff.diff.sample.length} {diff.diff.sample.length === 200 ? 'z více než 200' : ''})
          </summary>
          <div className="mt-2 max-h-64 overflow-auto rounded border">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-card">
                <tr className="border-b text-left">
                  <th className="px-2 py-1">Změna</th>
                  <th>Sektor</th>
                  <th>Řada</th>
                  <th>Seat</th>
                  <th>Z</th>
                  <th>Do</th>
                </tr>
              </thead>
              <tbody>
                {diff.diff.sample.map((c, i) => (
                  <tr key={i} className="border-b">
                    <td className="px-2 py-1">
                      <KindPill kind={c.kind} />
                    </td>
                    <td>{c.sector}</td>
                    <td>{c.row}</td>
                    <td>{c.num}</td>
                    <td className="font-mono text-[10px]">{c.from ? `${c.from.x},${c.from.y}` : ''}</td>
                    <td className="font-mono text-[10px]">{c.to ? `${c.to.x},${c.to.y}` : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  );
}

function DiffStat({ label, value, tone }: { label: string; value: number; tone?: 'emerald' | 'rose' | 'amber' }) {
  const colors = {
    emerald: 'border-emerald-200 bg-emerald-50 text-emerald-900',
    rose: 'border-rose-200 bg-rose-50 text-rose-900',
    amber: 'border-amber-200 bg-amber-50 text-amber-900',
  };
  return (
    <div className={`rounded-md border p-2 ${tone ? colors[tone] : ''}`}>
      <div className="text-[10px] uppercase opacity-70">{label}</div>
      <div className="text-lg font-bold tabular-nums">{value.toLocaleString('cs-CZ')}</div>
    </div>
  );
}

function KindPill({ kind }: { kind: DiffSeatChange['kind'] }) {
  const map: Record<DiffSeatChange['kind'], { label: string; cls: string }> = {
    added: { label: '+ added', cls: 'bg-emerald-100 text-emerald-800' },
    removed: { label: '− removed', cls: 'bg-rose-100 text-rose-800' },
    moved: { label: '↔ moved', cls: 'bg-amber-100 text-amber-800' },
    'accessibility-changed': { label: '♿ a11y', cls: 'bg-blue-100 text-blue-800' },
  };
  const { label, cls } = map[kind];
  return <span className={`rounded px-1.5 py-0.5 text-[10px] ${cls}`}>{label}</span>;
}
