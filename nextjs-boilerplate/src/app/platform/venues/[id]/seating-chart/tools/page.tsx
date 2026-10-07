'use client';

import { useEffect, useState, use } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

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

interface SectorSummary {
  name: string;
  color?: string;
  rowCount: number;
  seatCount: number;
  rowLabels: string[];
}

interface Suggestion {
  kind: 'alpha-rows' | 'splittable-sector' | 'column-sector';
  sectorName: string;
  description: string;
  op:
    | { type: 'renumber'; mode: 'numeric' | 'numeric-reverse' | 'alpha' | 'alpha-reverse' | 'custom' }
    | { type: 'split'; xMaxDist: number; yMaxDist: number; suggestedClusters: number }
    | { type: 'flatten'; renumberSeats: boolean };
}

interface ClusterDetail {
  count: number;
  clusters: { seatCount: number; minX: number; maxX: number; minY: number; maxY: number }[];
}

interface Stage {
  position: 'top' | 'bottom' | 'left' | 'right';
  label: string;
}

interface AnalysisResponse {
  chart: { id: string; name: string; totalSeats: number } | null;
  sectors: SectorSummary[];
  stage: Stage | null;
  suggestions: Suggestion[];
  splitDetails: Record<string, ClusterDetail>;
}

type Operation =
  | { op: 'renumber'; sectorName: string; mode: 'numeric' | 'numeric-reverse' | 'alpha' | 'alpha-reverse'; start?: number }
  | { op: 'split-spatial'; sectorName: string; xMaxDist: number; yMaxDist: number; names?: string[] }
  | { op: 'rename-sector'; from: string; to: string }
  | { op: 'flatten'; sectorName: string; rowLabel?: string; renumberSeats: boolean }
  | { op: 'set-stage'; stage: Stage | null };

export default function SectorToolsPage(
  props: {
    params: Promise<{ id: string }>;
  }
) {
  const params = use(props.params);
  const venueId = params.id;
  const router = useRouter();
  const [analysis, setAnalysis] = useState<AnalysisResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Operation[]>([]);
  const [busy, setBusy] = useState(false);
  const [splitNames, setSplitNames] = useState<Record<string, string[]>>({});
  const [renameInputs, setRenameInputs] = useState<Record<string, string>>({});
  const [stagePosition, setStagePosition] = useState<'top' | 'bottom' | 'left' | 'right'>('top');
  const [stageLabel, setStageLabel] = useState<string>('PODIUM');
  const [overlapResult, setOverlapResult] = useState<{
    chartName: string;
    totalSeats: number;
    totalSectors: number;
    pitch: number;
    radius: number;
    collisions: number;
    warnings: number;
    topCollisionSectors: Array<{ pair: string; count: number }>;
    sampleCollisions: Array<{ a: string; b: string; distance: number }>;
  } | null>(null);
  const [overlapBusy, setOverlapBusy] = useState(false);

  async function load() {
    setError(null);
    try {
      const res = await authFetch(`/api/platform/venues/${venueId}/seating-chart/transform`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = (await res.json()) as AnalysisResponse;
      setAnalysis(j);
      if (j.stage) {
        setStagePosition(j.stage.position);
        setStageLabel(j.stage.label);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => { void load(); }, [venueId]);

  async function checkOverlaps() {
    setOverlapBusy(true);
    setError(null);
    try {
      const res = await authFetch(`/api/platform/venues/${venueId}/seating-chart/overlap-check`, {
        method: 'POST',
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      const j = (await res.json()) as typeof overlapResult;
      setOverlapResult(j);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setOverlapBusy(false);
    }
  }

  function queueOp(op: Operation) {
    setPending((prev) => [...prev, op]);
  }

  function removeOp(idx: number) {
    setPending((prev) => prev.filter((_, i) => i !== idx));
  }

  async function commit() {
    if (pending.length === 0) return;
    if (!confirm(`Aplikovat ${pending.length} operac${pending.length === 1 ? 'i' : 'í'}? Vznikne nová verze chartu (stará zůstane v historii).`)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await authFetch(`/api/platform/venues/${venueId}/seating-chart/transform`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operations: pending }),
      });
      const j = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
      if (!res.ok) {
        setError(j.error ?? `HTTP ${res.status}`);
        return;
      }
      router.push(`/platform/venues/${venueId}/edit`);
    } finally {
      setBusy(false);
    }
  }

  if (!analysis) {
    return (
      <div className="space-y-4">
        <Link href={`/platform/venues/${venueId}/edit`} className="text-sm text-primary hover:underline">
          ← Zpět na detail sálu
        </Link>
        {error ? (
          <div className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">{error}</div>
        ) : (
          <p className="text-sm text-muted-foreground">Načítám analýzu…</p>
        )}
      </div>
    );
  }

  if (!analysis.chart) {
    return (
      <div className="space-y-4">
        <Link href={`/platform/venues/${venueId}/edit`} className="text-sm text-primary hover:underline">
          ← Zpět na detail sálu
        </Link>
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            Sál nemá žádný aktivní seating chart. Nejdřív ho importuj nebo vytvoř.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/platform/venues/${venueId}/edit`} className="text-sm text-primary hover:underline">
          ← Zpět na detail sálu
        </Link>
        <h1 className="mt-1 text-2xl font-bold">🛠 Sector tools</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Rename / renumber / split sektorů na <strong>{analysis.chart.name}</strong>{' '}
          ({analysis.chart.totalSeats} sedadel). Každá operace vytvoří novou verzi v historii — stará
          zůstane k dispozici pro restore.
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">{error}</div>
      )}

      {/* Overlap detection */}
      <Card>
        <CardHeader>
          <CardTitle>🎯 Detekce překryvů sedadel</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="text-muted-foreground">
            Spočítá render radius z layout pitch a najde sedadla, jejichž kruhy se vizuálně překrývají
            (matches algorithm v <code>scripts/check-overlaps.mjs</code>). Spusť před publikováním.
          </p>
          <div className="flex items-center gap-3">
            <Button onClick={() => void checkOverlaps()} disabled={overlapBusy}>
              {overlapBusy ? 'Kontroluji…' : '🔍 Spustit overlap check'}
            </Button>
            {overlapResult && (
              <Button variant="outline" size="sm" onClick={() => setOverlapResult(null)}>
                Skrýt výsledek
              </Button>
            )}
          </div>
          {overlapResult && (
            <div className={`rounded-md border p-3 ${
              overlapResult.collisions === 0
                ? 'border-emerald-300 bg-emerald-50'
                : 'border-rose-300 bg-rose-50'
            }`}>
              <div className="font-semibold">
                {overlapResult.collisions === 0
                  ? `✅ ${overlapResult.chartName}: žádné kolize`
                  : `❌ ${overlapResult.chartName}: ${overlapResult.collisions} kolizí`}
              </div>
              <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
                <div><strong>Sedadel:</strong> {overlapResult.totalSeats}</div>
                <div><strong>Sektorů:</strong> {overlapResult.totalSectors}</div>
                <div><strong>Pitch:</strong> {overlapResult.pitch}</div>
                <div><strong>Radius:</strong> {overlapResult.radius}</div>
              </div>
              {overlapResult.warnings > 0 && (
                <p className="mt-2 text-xs text-amber-700">
                  ⚠ {overlapResult.warnings} dvojic je vizuálně těsně (&lt;0.85× pitch)
                </p>
              )}
              {overlapResult.topCollisionSectors.length > 0 && (
                <div className="mt-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Top kolize per sektor
                  </p>
                  <ul className="mt-1 space-y-0.5 font-mono text-xs">
                    {overlapResult.topCollisionSectors.map((c) => (
                      <li key={c.pair}>
                        {String(c.count).padStart(5)}× {c.pair}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {overlapResult.sampleCollisions.length > 0 && (
                <details className="mt-3">
                  <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Ukázka dvojic ({overlapResult.sampleCollisions.length})
                  </summary>
                  <ul className="mt-1 space-y-0.5 font-mono text-xs">
                    {overlapResult.sampleCollisions.map((p, i) => (
                      <li key={i}>
                        {p.distance.toFixed(2)}px {p.a} ↔ {p.b}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Auto-suggestions */}
      {analysis.suggestions.length > 0 && (
        <Card className="border-blue-200 bg-blue-50/30">
          <CardHeader>
            <CardTitle>💡 Detekované problémy ({analysis.suggestions.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {analysis.suggestions.map((s, i) => (
              <div key={i} className="rounded-md border bg-card p-3 text-sm">
                <p>{s.description}</p>
                <div className="mt-2">
                  {s.op.type === 'renumber' && (
                    <Button
                      size="sm"
                      onClick={() =>
                        queueOp({ op: 'renumber', sectorName: s.sectorName, mode: 'numeric', start: 1 })
                      }
                    >
                      ✓ Renumber 1–{analysis.sectors.find((x) => x.name === s.sectorName)?.rowCount}
                    </Button>
                  )}
                  {s.op.type === 'flatten' && (
                    <Button
                      size="sm"
                      onClick={() =>
                        queueOp({
                          op: 'flatten',
                          sectorName: s.sectorName,
                          renumberSeats: true,
                        })
                      }
                    >
                      ✓ Sloučit do 1 řady ({analysis.sectors.find((x) => x.name === s.sectorName)?.seatCount} seats)
                    </Button>
                  )}
                  {s.op.type === 'split' && (
                    <SplitButton
                      sectorName={s.sectorName}
                      xMaxDist={s.op.xMaxDist}
                      yMaxDist={s.op.yMaxDist}
                      detail={analysis.splitDetails[s.sectorName] ?? null}
                      names={splitNames[s.sectorName] ?? []}
                      onNamesChange={(names) =>
                        setSplitNames((prev) => ({ ...prev, [s.sectorName]: names }))
                      }
                      onApply={(names) =>
                        queueOp({
                          op: 'split-spatial',
                          sectorName: s.sectorName,
                          xMaxDist: s.op.type === 'split' ? s.op.xMaxDist : 150,
                          yMaxDist: s.op.type === 'split' ? s.op.yMaxDist : 250,
                          names: names.filter((n) => n.trim().length > 0).length === names.length ? names : undefined,
                        })
                      }
                    />
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Stage / podium */}
      <Card>
        <CardHeader>
          <CardTitle>🎭 Pódium / jeviště</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {analysis.stage ? (
            <p className="text-muted-foreground">
              Aktuálně:{' '}
              <strong>{analysis.stage.label}</strong>{' '}
              ({{
                top: 'nahoře',
                bottom: 'dole',
                left: 'vlevo',
                right: 'vpravo',
              }[analysis.stage.position]})
            </p>
          ) : (
            <p className="text-amber-900">
              ⚠ Sál nemá nastavené pódium — diváci nepoznají kde je vepředu / vzadu.
            </p>
          )}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs uppercase text-muted-foreground">Pozice</label>
              <select
                value={stagePosition}
                onChange={(e) => setStagePosition(e.target.value as typeof stagePosition)}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              >
                <option value="top">▲ Nahoře (klasické divadlo)</option>
                <option value="bottom">▼ Dole</option>
                <option value="left">◀ Vlevo</option>
                <option value="right">▶ Vpravo</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs uppercase text-muted-foreground">Label</label>
              <Input
                value={stageLabel}
                onChange={(e) => setStageLabel(e.target.value)}
                maxLength={50}
                placeholder="PODIUM / JEVIŠTĚ / STAGE / SCÉNA"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() =>
                queueOp({ op: 'set-stage', stage: { position: stagePosition, label: stageLabel } })
              }
              disabled={!stageLabel.trim()}
            >
              {analysis.stage ? '✎ Aktualizovat pódium' : '✓ Přidat pódium'}
            </Button>
            {analysis.stage && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => queueOp({ op: 'set-stage', stage: null })}
              >
                ✕ Smazat pódium
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Manual sector editor */}
      <Card>
        <CardHeader>
          <CardTitle>Sektory ({analysis.sectors.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                <th className="py-2">Název</th>
                <th>Barva</th>
                <th className="text-right">Řad</th>
                <th className="text-right">Seats</th>
                <th>Vzorek řad</th>
                <th>Akce</th>
              </tr>
            </thead>
            <tbody>
              {analysis.sectors.map((sec) => (
                <tr key={sec.name} className="border-b align-top">
                  <td className="py-2 font-medium">
                    <Input
                      value={renameInputs[sec.name] ?? sec.name}
                      onChange={(e) =>
                        setRenameInputs((prev) => ({ ...prev, [sec.name]: e.target.value }))
                      }
                      className="h-8 text-sm"
                    />
                  </td>
                  <td>
                    {sec.color && (
                      <span
                        className="inline-block h-4 w-6 rounded border"
                        style={{ background: sec.color }}
                      />
                    )}
                  </td>
                  <td className="text-right tabular-nums">{sec.rowCount}</td>
                  <td className="text-right tabular-nums">{sec.seatCount}</td>
                  <td className="font-mono text-xs">
                    {sec.rowLabels.slice(0, 5).join(', ')}
                    {sec.rowLabels.length > 5 ? '…' : ''}
                  </td>
                  <td>
                    <div className="flex flex-col gap-1">
                      {(() => {
                        const currentInput = renameInputs[sec.name] ?? sec.name;
                        const changed = currentInput !== sec.name && currentInput.trim().length > 0;
                        const alreadyQueued = pending.some(
                          (op) => op.op === 'rename-sector' && op.from === sec.name,
                        );
                        return (
                          <Button
                            size="sm"
                            variant={changed ? 'default' : 'outline'}
                            disabled={!changed || alreadyQueued}
                            onClick={() =>
                              queueOp({
                                op: 'rename-sector',
                                from: sec.name,
                                to: currentInput,
                              })
                            }
                          >
                            {alreadyQueued ? '✓ V queue' : '✎ Přidat rename do queue'}
                          </Button>
                        );
                      })()}
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          queueOp({ op: 'renumber', sectorName: sec.name, mode: 'numeric', start: 1 })
                        }
                      >
                        🔢 Řady 1–N
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          queueOp({ op: 'flatten', sectorName: sec.name, renumberSeats: true })
                        }
                      >
                        ↕ Sloučit do 1 řady
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Pending operations */}
      <Card className={pending.length > 0 ? 'border-emerald-300' : ''}>
        <CardHeader>
          <CardTitle>Naplánované operace ({pending.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {pending.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Klikni na akce výše a tady se zobrazí queue. Pak klikni <strong>Aplikovat</strong>.
            </p>
          ) : (
            <ol className="space-y-1.5 text-sm">
              {pending.map((op, i) => (
                <li key={i} className="flex items-start justify-between gap-2 rounded-md border bg-card p-2">
                  <span className="font-mono text-xs">
                    {i + 1}. {describeOp(op)}
                  </span>
                  <button
                    onClick={() => removeOp(i)}
                    className="text-xs text-rose-700 hover:underline"
                  >
                    ✕ odstranit
                  </button>
                </li>
              ))}
            </ol>
          )}
          {pending.length > 0 && (
            <div className="mt-4 flex gap-2">
              <Button onClick={commit} disabled={busy}>
                {busy ? 'Aplikuji…' : `✓ Aplikovat ${pending.length} operac${pending.length === 1 ? 'i' : 'í'}`}
              </Button>
              <Button variant="outline" onClick={() => setPending([])} disabled={busy}>
                Zrušit queue
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function describeOp(op: Operation): string {
  if (op.op === 'renumber') {
    return `renumber "${op.sectorName}" → ${op.mode}${op.start ? ` od ${op.start}` : ''}`;
  }
  if (op.op === 'split-spatial') {
    return `split "${op.sectorName}" (X≤${op.xMaxDist}px, Y≤${op.yMaxDist}px${op.names ? `, jména: ${op.names.join(' / ')}` : ''})`;
  }
  if (op.op === 'flatten') {
    return `flatten "${op.sectorName}"${op.renumberSeats ? ' + přečíslovat' : ''}`;
  }
  if (op.op === 'set-stage') {
    return op.stage
      ? `set-stage(${op.stage.position}, "${op.stage.label}")`
      : 'remove-stage';
  }
  return `rename "${op.from}" → "${op.to}"`;
}

function SplitButton({
  sectorName, xMaxDist, yMaxDist, detail, names, onNamesChange, onApply,
}: {
  sectorName: string;
  xMaxDist: number;
  yMaxDist: number;
  detail: ClusterDetail | null;
  names: string[];
  onNamesChange: (names: string[]) => void;
  onApply: (names: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const count = detail?.count ?? 0;

  // Initialize names array to match cluster count
  useEffect(() => {
    if (open && names.length !== count) {
      onNamesChange(new Array(count).fill(''));
    }
  }, [open, count]);

  if (!open) {
    return (
      <Button size="sm" onClick={() => setOpen(true)}>
        ✂ Split na {count} sektorů…
      </Button>
    );
  }

  return (
    <div className="space-y-2 rounded-md border bg-muted/20 p-3">
      <div className="text-xs">
        Detekováno <strong>{count} clusterů</strong> v sektoru <strong>{sectorName}</strong>{' '}
        (X-práh {xMaxDist}px, Y-práh {yMaxDist}px).
        Pojmenuj každý cluster (volitelné — bez jména se použije <code>{sectorName} #1</code> atd.):
      </div>
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b text-left">
            <th className="py-1">#</th>
            <th>Seats</th>
            <th>X-rozsah</th>
            <th>Y-rozsah</th>
            <th>Lidské jméno</th>
          </tr>
        </thead>
        <tbody>
          {detail?.clusters.map((c, i) => (
            <tr key={i} className="border-b">
              <td className="py-1">{i + 1}</td>
              <td className="font-mono">{c.seatCount}</td>
              <td className="font-mono text-[10px]">{c.minX}–{c.maxX}</td>
              <td className="font-mono text-[10px]">{c.minY}–{c.maxY}</td>
              <td>
                <Input
                  value={names[i] ?? ''}
                  onChange={(e) => {
                    const next = [...names];
                    next[i] = e.target.value;
                    onNamesChange(next);
                  }}
                  placeholder={`např. ${guessName(c, i, count)}`}
                  className="h-7 text-xs"
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex gap-2">
        <Button size="sm" onClick={() => { onApply(names); setOpen(false); }}>
          ✓ Přidat split do queue
        </Button>
        <Button size="sm" variant="outline" onClick={() => setOpen(false)}>
          Zrušit
        </Button>
      </div>
    </div>
  );
}

function guessName(c: ClusterDetail['clusters'][number], _i: number, total: number): string {
  if (total === 3) {
    if (c.minY > 1500) return 'Balkon střed';
    return c.minX < 700 ? 'Balkon vlevo' : 'Balkon vpravo';
  }
  return 'Cluster';
}
