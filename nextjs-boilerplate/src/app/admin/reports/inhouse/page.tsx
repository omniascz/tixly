'use client';

import { useState, useMemo, useCallback } from 'react';
import { Search, Download, X, ChevronRight, BarChart2 } from 'lucide-react';
import { PageHeader } from '@/components/admin/PageHeader';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ALL_REPORTS, CATEGORIES } from '@/lib/reports/registry';
import type { ReportDef, ReportColumn } from '@/lib/reports/types';

// ── helpers ──────────────────────────────────────────────────────────────────

function today(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Prague' });
}
function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Prague' });
}

function fmtCell(val: unknown, type: ReportColumn['type']): string {
  if (val === null || val === undefined || val === '') return '—';
  if (type === 'currency_czk') {
    const n = typeof val === 'string' ? parseFloat(val) : Number(val);
    return isNaN(n) ? '—' : n.toLocaleString('cs-CZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' Kč';
  }
  if (type === 'pct') {
    const n = typeof val === 'string' ? parseFloat(val) : Number(val);
    return isNaN(n) ? '—' : n.toFixed(1) + ' %';
  }
  if (type === 'number') {
    const n = typeof val === 'string' ? parseInt(val, 10) : Number(val);
    return isNaN(n) ? '—' : n.toLocaleString('cs-CZ');
  }
  return String(val);
}

// ── report runner ─────────────────────────────────────────────────────────────

interface RunResult {
  columns: ReportColumn[];
  rows: Record<string, unknown>[];
  rowCount: number;
  truncated: boolean;
  execMs: number;
}

function buildUrl(def: ReportDef, params: Record<string, string>): string {
  const sp = new URLSearchParams({ reportId: def.id });
  for (const [k, v] of Object.entries(params)) {
    if (v) sp.set(k, v);
  }
  return `/api/admin/reports/run?${sp.toString()}`;
}

// ── component ─────────────────────────────────────────────────────────────────

export default function InhouseReportsPage() {
  const [query, setQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [selectedReport, setSelectedReport] = useState<ReportDef | null>(null);
  const [params, setParams] = useState<Record<string, string>>({});
  const [result, setResult] = useState<RunResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // default date range for params
  const defaultParams = useMemo(() => ({
    dateFrom: daysAgo(30),
    dateTo: today(),
  }), []);

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    return ALL_REPORTS.filter((r) => {
      if (activeCategory && r.category !== activeCategory) return false;
      if (!q) return true;
      return r.title.toLowerCase().includes(q) || r.description.toLowerCase().includes(q);
    });
  }, [query, activeCategory]);

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const r of ALL_REPORTS) {
      counts[r.category] = (counts[r.category] ?? 0) + 1;
    }
    return counts;
  }, []);

  const openReport = useCallback((def: ReportDef) => {
    setSelectedReport(def);
    setResult(null);
    setError(null);
    const init: Record<string, string> = { ...defaultParams };
    for (const p of def.params) {
      if (p.key in defaultParams) continue;
      init[p.key] = '';
    }
    setParams(init);
  }, [defaultParams]);

  const runReport = useCallback(async (def: ReportDef, fmt = 'json') => {
    const token = typeof localStorage !== 'undefined' ? (localStorage.getItem('accessToken') ?? '') : '';
    const url = buildUrl(def, params);

    if (fmt === 'csv') {
      const a = document.createElement('a');
      a.href = url + '&format=csv';
      a.download = `tixly-${def.id}.csv`;
      a.click();
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      const data = (await res.json()) as { error?: string } & RunResult;
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Chyba');
    } finally {
      setLoading(false);
    }
  }, [params]);

  return (
    <div className="flex h-full min-h-0 gap-0">
      {/* ── LEFT: catalog ── */}
      <aside className="flex w-72 shrink-0 flex-col border-r">
        <div className="border-b p-4">
          <PageHeader title={`Inhouse reporty (${ALL_REPORTS.length})`} description="" />
          <div className="relative mt-2">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Hledat report…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-8"
            />
          </div>
        </div>

        {/* Category filter */}
        <div className="border-b p-3">
          <button
            onClick={() => setActiveCategory(null)}
            className={`mb-1 flex w-full items-center justify-between rounded px-2 py-1.5 text-sm ${!activeCategory ? 'bg-primary/10 font-semibold text-primary' : 'text-muted-foreground hover:bg-muted'}`}
          >
            <span>Vše</span>
            <span className="text-xs">{ALL_REPORTS.length}</span>
          </button>
          {CATEGORIES.map((cat) => (
            <button
              key={cat.id}
              onClick={() => setActiveCategory(cat.id === activeCategory ? null : cat.id)}
              className={`flex w-full items-center justify-between rounded px-2 py-1.5 text-sm ${activeCategory === cat.id ? 'bg-primary/10 font-semibold text-primary' : 'text-muted-foreground hover:bg-muted'}`}
            >
              <span>{cat.label}</span>
              <span className="text-xs">{categoryCounts[cat.id] ?? 0}</span>
            </button>
          ))}
        </div>

        {/* Report list */}
        <div className="flex-1 overflow-y-auto p-2">
          {filtered.length === 0 && (
            <p className="p-4 text-center text-xs text-muted-foreground">Žádný report nenalezen.</p>
          )}
          {filtered.map((r) => (
            <button
              key={r.id}
              onClick={() => openReport(r)}
              className={`mb-1 flex w-full items-start gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors
                ${selectedReport?.id === r.id ? 'bg-primary/10 text-primary' : 'hover:bg-muted'}`}
            >
              <BarChart2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <div className="min-w-0">
                <p className="truncate font-medium leading-tight">{r.title}</p>
                <p className="truncate text-xs text-muted-foreground">{r.description}</p>
              </div>
              <ChevronRight className="ml-auto mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            </button>
          ))}
        </div>
      </aside>

      {/* ── RIGHT: report detail ── */}
      <main className="flex-1 overflow-y-auto p-6">
        {!selectedReport ? (
          <div className="flex h-full flex-col items-center justify-center text-center text-muted-foreground">
            <BarChart2 className="mb-3 h-10 w-10 opacity-30" />
            <p className="text-sm">Vyberte report ze seznamu vlevo.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Header */}
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold">{selectedReport.title}</h2>
                <p className="text-sm text-muted-foreground">{selectedReport.description}</p>
                <div className="mt-1 flex gap-2">
                  <Badge variant="secondary">{selectedReport.category}</Badge>
                  {selectedReport.scope === 'platform' && (
                    <Badge variant="destructive">Platform admin</Badge>
                  )}
                </div>
              </div>
              <Button variant="ghost" size="sm" onClick={() => { setSelectedReport(null); setResult(null); }}>
                <X className="h-4 w-4" />
              </Button>
            </div>

            {/* Params */}
            {selectedReport.params.length > 0 && (
              <div className="rounded-md border p-4">
                <p className="mb-3 text-sm font-medium">Parametry</p>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {selectedReport.params.map((p) => (
                    <div key={p.key}>
                      <label className="mb-1 block text-xs font-medium text-muted-foreground">
                        {p.label}{p.required ? ' *' : ''}
                      </label>
                      {p.type === 'select' && p.options ? (
                        <select
                          value={params[p.key] ?? ''}
                          onChange={(e) => setParams((prev) => ({ ...prev, [p.key]: e.target.value }))}
                          className="w-full rounded-md border bg-background px-3 py-1.5 text-sm"
                        >
                          <option value="">— vybrat —</option>
                          {p.options.map((o) => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                        </select>
                      ) : (
                        <Input
                          type={p.type === 'date' ? 'date' : p.type === 'month' ? 'month' : 'text'}
                          value={params[p.key] ?? ''}
                          onChange={(e) => setParams((prev) => ({ ...prev, [p.key]: e.target.value }))}
                          placeholder={p.type === 'uuid' ? 'UUID akce' : ''}
                        />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-2">
              <Button onClick={() => void runReport(selectedReport)} disabled={loading}>
                {loading ? 'Načítám…' : 'Spustit report'}
              </Button>
              <Button
                variant="outline"
                onClick={() => void runReport(selectedReport, 'csv')}
                disabled={loading}
              >
                <Download className="mr-1 h-4 w-4" />
                Stáhnout CSV
              </Button>
            </div>

            {/* Error */}
            {error && (
              <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">
                Chyba: {error}
              </div>
            )}

            {/* Result table */}
            {result && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">
                    {result.rowCount.toLocaleString('cs-CZ')} řádků
                    {result.truncated ? ' (výsledek zkrácen na max. 5000)' : ''}
                    {' · '}{result.execMs} ms
                  </p>
                </div>
                <div className="overflow-auto rounded-md border">
                  <table className="min-w-full text-sm">
                    <thead className="bg-muted/50 text-left text-xs font-medium text-muted-foreground">
                      <tr>
                        {result.columns.map((col) => (
                          <th key={col.key} className="whitespace-nowrap px-3 py-2">
                            {col.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {result.rows.map((row, i) => (
                        <tr key={i} className="hover:bg-muted/30">
                          {result.columns.map((col) => {
                            const val = row[col.key];
                            const txt = fmtCell(val, col.type);
                            return (
                              <td
                                key={col.key}
                                className={`whitespace-nowrap px-3 py-1.5 ${
                                  col.type === 'currency_czk' || col.type === 'number' || col.type === 'pct'
                                    ? 'text-right tabular-nums'
                                    : ''
                                }`}
                              >
                                {col.type === 'badge' ? (
                                  <Badge variant="secondary" className="text-[10px]">{txt}</Badge>
                                ) : txt}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {result.rows.length === 0 && (
                    <p className="p-6 text-center text-sm text-muted-foreground">
                      Žádná data pro zvolené parametry.
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
