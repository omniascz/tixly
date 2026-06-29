'use client';

import { useCallback, useEffect, useState } from 'react';
import { BarChart3, RefreshCw } from 'lucide-react';
import { PageHeader } from '@/components/admin/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatCzk, formatCzechDateShort } from '@/lib/format';

interface RfmScore {
  id: string;
  userId: string;
  email: string;
  name: string | null;
  recencyDays: number;
  frequency: number;
  monetaryHalire: number;
  rScore: number;
  fScore: number;
  mScore: number;
  rfmTotal: number;
  segment: 'A' | 'B' | 'C' | 'D';
  computedAt: string;
}

interface RfmResponse {
  scores: RfmScore[];
  totals: { A: number; B: number; C: number; D: number };
  avgMonetary: number;
  lastComputed: string | null;
  page: number;
  perPage: number;
}

interface ComputeResult {
  computed: number;
  segments: { A: number; B: number; C: number; D: number };
}

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

const SEGMENT_META = {
  A: { label: 'Champions', color: 'bg-emerald-500', textColor: 'text-emerald-700', bg: 'bg-emerald-50', border: 'border-emerald-200' },
  B: { label: 'Věrní', color: 'bg-blue-500', textColor: 'text-blue-700', bg: 'bg-blue-50', border: 'border-blue-200' },
  C: { label: 'Ohrožení', color: 'bg-orange-500', textColor: 'text-orange-700', bg: 'bg-orange-50', border: 'border-orange-200' },
  D: { label: 'Ztracení', color: 'bg-red-500', textColor: 'text-red-700', bg: 'bg-red-50', border: 'border-red-200' },
} as const;

function SegmentBadge({ segment }: { segment: 'A' | 'B' | 'C' | 'D' }) {
  const m = SEGMENT_META[segment];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${m.bg} ${m.textColor}`}>
      {segment} · {m.label}
    </span>
  );
}

function HeatmapCell({ count, maxCount }: { count: number; maxCount: number }) {
  const intensity = maxCount > 0 ? count / maxCount : 0;
  const bgClass = count === 0 ? 'bg-muted' : `bg-blue-500`;
  return (
    <div
      className={`flex h-10 w-full items-center justify-center rounded text-xs font-medium transition-colors ${bgClass}`}
      style={{ opacity: count === 0 ? 1 : 0.15 + intensity * 0.85 }}
      title={`${count} zákazníků`}
    >
      <span className={count === 0 ? 'text-muted-foreground' : 'text-blue-900 font-semibold'}>
        {count > 0 ? count : ''}
      </span>
    </div>
  );
}

export default function RfmPage() {
  const [data, setData] = useState<RfmResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [computing, setComputing] = useState(false);
  const [segFilter, setSegFilter] = useState<string>('');
  const [sort, setSort] = useState<'monetary' | 'frequency' | 'recency'>('monetary');
  const [page, setPage] = useState(1);

  const [heatmap, setHeatmap] = useState<Record<string, number>>({});

  const loadHeatmap = useCallback(async () => {
    const res = await authFetch('/api/admin/crm/rfm?per_page=500&page=1');
    if (!res.ok) return;
    const d = (await res.json()) as RfmResponse;
    const map: Record<string, number> = {};
    for (let r = 1; r <= 5; r++) {
      for (let f = 1; f <= 5; f++) {
        map[`${r}_${f}`] = 0;
      }
    }
    for (const s of d.scores) {
      const key = `${s.rScore}_${s.fScore}`;
      map[key] = (map[key] ?? 0) + 1;
    }
    setHeatmap(map);
  }, []);

  const load = useCallback(async (seg: string, s: string, p: number) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ sort: s, page: String(p), per_page: '50' });
      if (seg) params.set('segment', seg);
      const res = await authFetch(`/api/admin/crm/rfm?${params}`);
      if (!res.ok) return;
      const d = (await res.json()) as RfmResponse;
      setData(d);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(segFilter, sort, page);
  }, [segFilter, sort, page, load]);

  useEffect(() => {
    void loadHeatmap();
  }, [loadHeatmap]);

  async function compute() {
    setComputing(true);
    try {
      const res = await authFetch('/api/admin/crm/rfm/compute', { method: 'POST' });
      if (res.ok) {
        const r = (await res.json()) as ComputeResult;
        void load(segFilter, sort, 1);
        void loadHeatmap();
        setPage(1);
        alert(`Přepočítáno: ${r.computed} zákazníků. A:${r.segments.A} B:${r.segments.B} C:${r.segments.C} D:${r.segments.D}`);
      }
    } finally {
      setComputing(false);
    }
  }

  const totals = data?.totals ?? { A: 0, B: 0, C: 0, D: 0 };
  const total = totals.A + totals.B + totals.C + totals.D;
  const maxHeatCount = Math.max(1, ...Object.values(heatmap));

  return (
    <div className="space-y-6">
      <PageHeader
        title="RFM Segmentace zákazníků"
        description="Recency · Frequency · Monetary — analýza zákaznické hodnoty"
        actions={
          <Button onClick={() => void compute()} disabled={computing} size="sm">
            <RefreshCw className={`mr-1.5 h-4 w-4 ${computing ? 'animate-spin' : ''}`} aria-hidden />
            {computing ? 'Přepočítávám…' : 'Přepočítat'}
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {(['A', 'B', 'C', 'D'] as const).map((seg) => {
          const m = SEGMENT_META[seg];
          const count = totals[seg];
          const pct = total > 0 ? Math.round((count / total) * 100) : 0;
          return (
            <Card
              key={seg}
              className={`cursor-pointer border-2 transition-colors ${segFilter === seg ? m.border + ' ' + m.bg : 'hover:' + m.bg}`}
              onClick={() => { setSegFilter(segFilter === seg ? '' : seg); setPage(1); }}
            >
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm font-medium">
                  <span className={`h-3 w-3 rounded-full ${m.color}`} />
                  {seg} — {m.label}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{count}</p>
                <p className="text-xs text-muted-foreground">{pct} % zákazníků</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <BarChart3 className="h-4 w-4" aria-hidden />
            RFM heatmapa (Recency × Frequency)
          </CardTitle>
          <p className="text-xs text-muted-foreground">Osa X = F skóre (1–5), Osa Y = R skóre (5–1). Tmavší = více zákazníků.</p>
        </CardHeader>
        <CardContent>
          <div className="flex gap-3">
            <div className="flex flex-col justify-around text-xs text-muted-foreground w-12 text-right pt-1 pb-1">
              {[5, 4, 3, 2, 1].map((r) => (
                <span key={r}>R={r}</span>
              ))}
            </div>
            <div className="flex-1">
              <div className="mb-1 grid grid-cols-5 gap-1 text-center text-xs text-muted-foreground">
                {[1, 2, 3, 4, 5].map((f) => <span key={f}>F={f}</span>)}
              </div>
              <div className="grid gap-1" style={{ gridTemplateRows: 'repeat(5, 1fr)' }}>
                {[5, 4, 3, 2, 1].map((r) => (
                  <div key={r} className="grid grid-cols-5 gap-1">
                    {[1, 2, 3, 4, 5].map((f) => (
                      <HeatmapCell key={f} count={heatmap[`${r}_${f}`] ?? 0} maxCount={maxHeatCount} />
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-3">
            <CardTitle className="text-base">Zákazníci</CardTitle>
            <div className="flex gap-1">
              {(['', 'A', 'B', 'C', 'D'] as const).map((seg) => (
                <button
                  key={seg}
                  onClick={() => { setSegFilter(seg); setPage(1); }}
                  className={`rounded-full px-3 py-0.5 text-xs font-medium transition-colors ${
                    segFilter === seg
                      ? 'bg-foreground text-background'
                      : 'bg-muted text-muted-foreground hover:bg-secondary'
                  }`}
                >
                  {seg === '' ? 'Vše' : `${seg} · ${SEGMENT_META[seg].label}`}
                </button>
              ))}
            </div>
            <div className="ml-auto">
              <select
                value={sort}
                onChange={(e) => { setSort(e.target.value as typeof sort); setPage(1); }}
                className="rounded-md border bg-background px-3 py-1.5 text-sm"
              >
                <option value="monetary">Útrata (nejvyšší)</option>
                <option value="frequency">Počet objednávek</option>
                <option value="recency">Poslední nákup (nejnovější)</option>
              </select>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading && !data ? (
            <div className="py-12 text-center text-sm text-muted-foreground">Načítám…</div>
          ) : !data || data.scores.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              Žádná data — klikněte na „Přepočítat" pro výpočet skóre.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/30 text-xs text-muted-foreground">
                    <th className="px-4 py-2 text-left">Email / Jméno</th>
                    <th className="px-4 py-2 text-left">Segment</th>
                    <th className="px-4 py-2 text-center">R</th>
                    <th className="px-4 py-2 text-center">F</th>
                    <th className="px-4 py-2 text-center">M</th>
                    <th className="px-4 py-2 text-right">Poslední nákup</th>
                    <th className="px-4 py-2 text-right">Utraceno</th>
                    <th className="px-4 py-2 text-right">Objednávky</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {data.scores.map((s) => (
                    <tr key={s.id} className="hover:bg-muted/20">
                      <td className="px-4 py-2.5">
                        <div className="font-medium">{s.name ?? '—'}</div>
                        <div className="text-xs text-muted-foreground">{s.email}</div>
                      </td>
                      <td className="px-4 py-2.5">
                        <SegmentBadge segment={s.segment as 'A' | 'B' | 'C' | 'D'} />
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        <ScorePip score={s.rScore} color="bg-teal-500" />
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        <ScorePip score={s.fScore} color="bg-violet-500" />
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        <ScorePip score={s.mScore} color="bg-amber-500" />
                      </td>
                      <td className="px-4 py-2.5 text-right text-muted-foreground">
                        {s.computedAt ? formatCzechDateShort(s.computedAt) : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-right font-semibold">
                        {formatCzk(s.monetaryHalire)}
                      </td>
                      <td className="px-4 py-2.5 text-right">{s.frequency}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {data && data.scores.length === data.perPage && (
        <div className="flex justify-center">
          <Button
            variant="outline"
            onClick={() => setPage((p) => p + 1)}
            disabled={loading}
          >
            Načíst další
          </Button>
        </div>
      )}

      {data?.lastComputed && (
        <p className="text-xs text-muted-foreground text-center">
          Poslední výpočet: {formatCzechDateShort(data.lastComputed)}
        </p>
      )}
    </div>
  );
}

function ScorePip({ score, color }: { score: number; color: string }) {
  return (
    <div className="flex items-center justify-center gap-0.5">
      {Array.from({ length: 5 }).map((_, i) => (
        <span
          key={i}
          className={`h-2 w-2 rounded-full ${i < score ? color : 'bg-muted'}`}
        />
      ))}
    </div>
  );
}
