'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { classifyChartSize } from '@/lib/seating/perf';
import { generateStadium, type StandSide, type StadiumStand } from '@/lib/seating/stadium';

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

interface StandForm {
  side: StandSide;
  name: string;
  enabled: boolean;
  rows: number;
  seatsPerRow: number;
  tiers: number;
  color: string;
}

const DEFAULT_STANDS: StandForm[] = [
  { side: 'N', name: 'Sever', enabled: true, rows: 30, seatsPerRow: 180, tiers: 2, color: '#2563eb' },
  { side: 'S', name: 'Jih', enabled: true, rows: 30, seatsPerRow: 180, tiers: 2, color: '#dc2626' },
  { side: 'E', name: 'Východ', enabled: true, rows: 24, seatsPerRow: 120, tiers: 1, color: '#16a34a' },
  { side: 'W', name: 'Západ', enabled: true, rows: 24, seatsPerRow: 120, tiers: 1, color: '#d97706' },
];

export default function StadiumBuilderPage({ params }: { params: { id: string } }) {
  const venueId = params.id;
  const [chartName, setChartName] = useState('Stadion');
  const [pitchLabel, setPitchLabel] = useState('HŘIŠTĚ');
  const [stands, setStands] = useState<StandForm[]>(DEFAULT_STANDS);
  const [corners, setCorners] = useState(true);
  const [cornerRows, setCornerRows] = useState(14);
  const [cornerSeatsPerRow, setCornerSeatsPerRow] = useState(16);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiLoading, setAiLoading] = useState(false);

  function setStand(i: number, patch: Partial<StandForm>) {
    setStands((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  }

  // AI: popiš stadion slovy → návrh tribun (na klíč — bez ANTHROPIC_API_KEY vrátí route 503).
  async function aiStadium() {
    if (!aiPrompt.trim()) {
      setError('Napiš popis stadionu (např. „stadion pro 50 000, 4 tribuny, 2 patra, s rohy").');
      return;
    }
    setError(null);
    setFeedback(null);
    setAiLoading(true);
    try {
      const res = await authFetch(`/api/platform/venues/${venueId}/seating-chart/from-text-stadium`, {
        method: 'POST',
        body: JSON.stringify({ prompt: aiPrompt }),
      });
      const j = (await res.json()) as {
        spec?: {
          pitchLabel?: string;
          stands: { side: StandSide; name: string; rows: number; seatsPerRow: number; tiers?: number }[];
          corners?: boolean;
          cornerRows?: number;
          cornerSeatsPerRow?: number;
        };
        totalSeats?: number;
        message?: string;
        error?: string;
      };
      if (!res.ok || !j.spec) {
        setError(j.message ?? j.error ?? `AI selhalo (HTTP ${res.status}).`);
        return;
      }
      const bySide = new Map(j.spec.stands.map((s) => [s.side, s]));
      setStands((prev) =>
        prev.map((f) => {
          const s = bySide.get(f.side);
          if (!s) return { ...f, enabled: false };
          return { ...f, enabled: true, name: s.name || f.name, rows: s.rows, seatsPerRow: s.seatsPerRow, tiers: s.tiers ?? 1 };
        }),
      );
      setCorners(!!j.spec.corners);
      if (j.spec.cornerRows) setCornerRows(j.spec.cornerRows);
      if (j.spec.cornerSeatsPerRow) setCornerSeatsPerRow(j.spec.cornerSeatsPerRow);
      if (j.spec.pitchLabel) setPitchLabel(j.spec.pitchLabel);
      setFeedback(`AI navrhla stadion: ~${(j.totalSeats ?? 0).toLocaleString('cs-CZ')} sedadel. Zkontroluj náhled a dolaď, pak ulož.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'AI selhalo.');
    } finally {
      setAiLoading(false);
    }
  }

  const layout = useMemo(() => {
    const active: StadiumStand[] = stands
      .filter((s) => s.enabled && s.rows > 0 && s.seatsPerRow > 0)
      .map((s) => ({ side: s.side, name: s.name, rows: s.rows, seatsPerRow: s.seatsPerRow, tiers: s.tiers, color: s.color }));
    if (active.length === 0) return null;
    return generateStadium({
      pitchLabel,
      stands: active,
      corners,
      cornerRows,
      cornerSeatsPerRow,
    });
  }, [stands, pitchLabel, corners, cornerRows, cornerSeatsPerRow]);

  const perf = layout ? classifyChartSize(layout.totalSeats) : null;

  // Lehký schematický náhled — bounding box + počet na sektor (ne jednotlivá sedadla).
  const preview = useMemo(() => {
    if (!layout) return null;
    const blocks = layout.sectors.map((sec) => {
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, count = 0;
      for (const row of sec.rows) {
        for (const seat of row.seats) {
          if (seat.x < minX) minX = seat.x;
          if (seat.x > maxX) maxX = seat.x;
          if (seat.y < minY) minY = seat.y;
          if (seat.y > maxY) maxY = seat.y;
          count++;
        }
      }
      return { name: sec.name, color: sec.color, minX, minY, w: maxX - minX, h: maxY - minY, count };
    });
    return { blocks, overlays: layout.overlays, viewBox: layout.viewBox };
  }, [layout]);

  async function save() {
    if (!layout) {
      setError('Zapni aspoň jednu tribunu.');
      return;
    }
    setSaving(true);
    setError(null);
    setFeedback(null);
    try {
      const res = await authFetch(`/api/platform/venues/${venueId}/seating-chart`, {
        method: 'POST',
        body: JSON.stringify({
          name: chartName,
          layout: { viewBox: layout.viewBox, sectors: layout.sectors, overlays: layout.overlays },
        }),
      });
      const j = (await res.json().catch(() => ({}))) as { totalSeats?: number; error?: string };
      if (!res.ok) {
        setError(j.error ?? `Uložení selhalo (HTTP ${res.status}).`);
        return;
      }
      setFeedback(`✓ Stadion uložen — ${j.totalSeats ?? layout.totalSeats} sedadel. Můžeš ho otevřít ve vizuálním editoru a doladit.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Uložení selhalo.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <Link href={`/platform/venues/${venueId}/edit`} className="text-sm text-primary hover:underline">
            ← Zpět na detail sálu
          </Link>
          <h1 className="mt-1 text-2xl font-bold">🏟 Generátor stadionu (bowl)</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Zadej tribuny kolem hřiště (řady × místa, patra) a systém rozmístí sedadla do mísy.
            Vhodné pro velké stadiony (10k–100k). Po uložení dolaď ve{' '}
            <Link href={`/platform/venues/${venueId}/seating-chart/editor`} className="underline">vizuálním editoru</Link>.
          </p>
        </div>
      </div>

      {error ? <div className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">{error}</div> : null}
      {feedback ? <div className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">{feedback}</div> : null}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {/* ── Zadání ── */}
        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-base">🪄 Popiš stadion slovy (AI)</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              <p className="text-xs text-muted-foreground">
                Např. „stadion pro 50 000 diváků, 4 tribuny, 2 patra, s rohy". AI navrhne tribuny,
                pak dolaď čísla a ulož.
              </p>
              <textarea
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                rows={2}
                placeholder="Popiš stadion… (např. pro 50 000, 4 tribuny, 2 patra)"
                className="w-full rounded-md border bg-background p-2 text-sm"
              />
              <Button type="button" size="sm" onClick={() => void aiStadium()} disabled={aiLoading}>
                {aiLoading ? 'Generuji…' : '🪄 Navrhnout stadion (AI)'}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Základ</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium uppercase text-muted-foreground">Název</label>
                <Input value={chartName} onChange={(e) => setChartName(e.target.value)} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium uppercase text-muted-foreground">Popisek hřiště</label>
                <Input className="max-w-xs" value={pitchLabel} onChange={(e) => setPitchLabel(e.target.value)} />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Tribuny</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {stands.map((s, i) => (
                <div key={s.side} className="rounded-lg border p-3">
                  <div className="mb-2 flex items-center gap-2">
                    <input type="checkbox" checked={s.enabled} onChange={(e) => setStand(i, { enabled: e.target.checked })} />
                    <input type="color" value={s.color} onChange={(e) => setStand(i, { color: e.target.value })} className="h-6 w-8 rounded border" aria-label="Barva" />
                    <Input value={s.name} onChange={(e) => setStand(i, { name: e.target.value })} className="max-w-[150px]" />
                    <span className="text-xs text-muted-foreground">({s.side})</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <label className="text-xs">Řad
                      <Input type="number" min={0} max={120} value={s.rows} onChange={(e) => setStand(i, { rows: Math.max(0, parseInt(e.target.value || '0', 10)) })} />
                    </label>
                    <label className="text-xs">Míst/řada
                      <Input type="number" min={0} max={400} value={s.seatsPerRow} onChange={(e) => setStand(i, { seatsPerRow: Math.max(0, parseInt(e.target.value || '0', 10)) })} />
                    </label>
                    <label className="text-xs">Patra
                      <Input type="number" min={1} max={5} value={s.tiers} onChange={(e) => setStand(i, { tiers: Math.max(1, parseInt(e.target.value || '1', 10)) })} />
                    </label>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Rohy</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={corners} onChange={(e) => setCorners(e.target.checked)} />
                Přidat rohové sektory (zaoblí mísu)
              </label>
              {corners ? (
                <div className="grid grid-cols-2 gap-2">
                  <label className="text-xs">Řad v rohu
                    <Input type="number" min={1} max={60} value={cornerRows} onChange={(e) => setCornerRows(Math.max(1, parseInt(e.target.value || '1', 10)))} />
                  </label>
                  <label className="text-xs">Míst/řada v rohu
                    <Input type="number" min={1} max={120} value={cornerSeatsPerRow} onChange={(e) => setCornerSeatsPerRow(Math.max(1, parseInt(e.target.value || '1', 10)))} />
                  </label>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>

        {/* ── Náhled ── */}
        <div className="space-y-3">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Náhled — {layout ? layout.totalSeats.toLocaleString('cs-CZ') : 0} sedadel
              </CardTitle>
            </CardHeader>
            <CardContent>
              {preview ? (
                <svg viewBox={preview.viewBox} className="block w-full rounded bg-slate-50" style={{ maxHeight: 460 }}>
                  {preview.overlays.map((ov) => (
                    <g key={ov.id}>
                      <rect x={ov.x} y={ov.y} width={ov.width} height={ov.height} fill="#16a34a" rx={8} />
                      <rect x={ov.x + 10} y={ov.y + 10} width={ov.width - 20} height={ov.height - 20} fill="none" stroke="white" strokeWidth={3} />
                      <line x1={ov.x + ov.width / 2} y1={ov.y + 10} x2={ov.x + ov.width / 2} y2={ov.y + ov.height - 10} stroke="white" strokeWidth={3} />
                      <circle cx={ov.x + ov.width / 2} cy={ov.y + ov.height / 2} r={ov.height * 0.16} fill="none" stroke="white" strokeWidth={3} />
                      <text x={ov.x + ov.width / 2} y={ov.y + ov.height / 2} textAnchor="middle" dominantBaseline="middle" fontSize={Math.max(20, ov.height * 0.12)} fill="white" fontWeight="700">{ov.label}</text>
                    </g>
                  ))}
                  {preview.blocks.map((b, i) => (
                    <g key={i}>
                      <rect x={b.minX} y={b.minY} width={b.w} height={b.h} fill={b.color} opacity={0.82} rx={6} />
                      <text x={b.minX + b.w / 2} y={b.minY + b.h / 2 - 12} textAnchor="middle" dominantBaseline="middle" fontSize={Math.max(22, b.h * 0.16)} fill="white" fontWeight="700">{b.name}</text>
                      <text x={b.minX + b.w / 2} y={b.minY + b.h / 2 + 18} textAnchor="middle" dominantBaseline="middle" fontSize={Math.max(18, b.h * 0.12)} fill="white">{b.count.toLocaleString('cs-CZ')} míst</text>
                    </g>
                  ))}
                </svg>
              ) : (
                <p className="text-sm text-muted-foreground">Zapni aspoň jednu tribunu.</p>
              )}
            </CardContent>
          </Card>

          {perf ? (
            <div
              className={`rounded-md border p-3 text-xs ${
                perf.level === 'ok' ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
                  : perf.level === 'caution' ? 'border-sky-300 bg-sky-50 text-sky-900'
                    : perf.level === 'warning' ? 'border-amber-300 bg-amber-50 text-amber-900'
                      : 'border-rose-300 bg-rose-50 text-rose-900'
              }`}
            >
              <div className="font-semibold">{perf.message}</div>
              {perf.recommendations.length > 0 ? (
                <ul className="mt-1 list-disc pl-4">
                  {perf.recommendations.map((r, i) => <li key={i}>{r}</li>)}
                </ul>
              ) : null}
            </div>
          ) : null}

          <Button onClick={save} disabled={saving || !layout} className="w-full">
            {saving ? 'Ukládám…' : `Uložit stadion (${layout ? layout.totalSeats.toLocaleString('cs-CZ') : 0} sedadel)`}
          </Button>
        </div>
      </div>
    </div>
  );
}
