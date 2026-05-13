'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/admin/PageHeader';
import { Filter, ChevronDown, ChevronRight } from 'lucide-react';

interface LogEntry {
  id: string;
  schema: string;
  table: string;
  recordId: string;
  action: 'INSERT' | 'UPDATE' | 'DELETE';
  actorId: string | null;
  actorEmail: string | null;
  actorName: string | null;
  actorType: string;
  oldValues: Record<string, unknown> | null;
  newValues: Record<string, unknown> | null;
  ipAddress: string | null;
  createdAt: string;
}

interface ApiResponse {
  entries: LogEntry[];
  filters: { tables: { name: string; count: number }[] };
}

const ACTION_LABELS: Record<string, { label: string; tone: string }> = {
  INSERT: { label: 'Vytvoření', tone: 'bg-emerald-100 text-emerald-900' },
  UPDATE: { label: 'Úprava', tone: 'bg-amber-100 text-amber-900' },
  DELETE: { label: 'Smazání', tone: 'bg-rose-100 text-rose-900' },
};

const TABLE_FRIENDLY: Record<string, string> = {
  orders: 'Objednávky',
  events: 'Akce',
  ticket_types: 'Typy lístků',
  tickets: 'Lístky',
  refunds: 'Refundy',
  promo_codes: 'Promo kódy',
  promoters: 'Profil promotéra',
  venues: 'Sály',
  event_seats: 'Sedadla',
  access_codes: 'Přístupové kódy',
};

function authFetch(url: string): Promise<Response> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
  return fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
}

export default function AuditLogPage() {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [tables, setTables] = useState<{ name: string; count: number }[]>([]);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Filtry
  const [actionFilter, setActionFilter] = useState<'' | 'INSERT' | 'UPDATE' | 'DELETE'>('');
  const [tableFilter, setTableFilter] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    setBusy(true);
    const params = new URLSearchParams();
    if (actionFilter) params.set('action', actionFilter);
    if (tableFilter) params.set('table', tableFilter);
    if (fromDate) params.set('from', new Date(fromDate).toISOString());
    if (toDate) {
      const t = new Date(toDate);
      t.setDate(t.getDate() + 1);
      params.set('to', t.toISOString());
    }
    params.set('limit', '200');
    try {
      const res = await authFetch(`/api/admin/audit-log?${params.toString()}`);
      if (!res.ok) return;
      const data = (await res.json()) as ApiResponse;
      setEntries(data.entries);
      setTables(data.filters.tables);
    } finally {
      setBusy(false);
    }
  }

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function friendlyTable(t: string): string {
    return TABLE_FRIENDLY[t] ?? t;
  }

  function describeAction(e: LogEntry): string {
    const t = friendlyTable(e.table);
    if (e.action === 'INSERT') return `Vytvořeno: ${t}`;
    if (e.action === 'DELETE') return `Smazáno: ${t}`;
    // UPDATE — pokus o čitelný diff
    if (e.newValues && typeof e.newValues === 'object') {
      const v = e.newValues as Record<string, unknown>;
      if (v.kind === 'refund') return 'Refund objednávky';
      if (v.action === 'resend_email') return 'Resend emailu kupci';
      if (v.action === 'transfer') return 'Převod lístku';
      if (v.action === 'name_change') return 'Změna jména držitele';
      if (v.action === 'cancel_ticket') return 'Storno lístku';
      if (v.status) return `Změna stavu na "${v.status}" — ${t}`;
    }
    return `Úprava: ${t}`;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Audit log"
        description="Co kdo z tvého týmu kdy udělal. Pro compliance, support a vyšetřování incidentů. Posledních 90 dní."
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Filter className="h-5 w-5" aria-hidden /> Filtry
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <div>
              <label className="mb-1 block text-xs font-medium">Akce</label>
              <select
                value={actionFilter}
                onChange={(e) => setActionFilter(e.target.value as typeof actionFilter)}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              >
                <option value="">Všechny</option>
                <option value="INSERT">Vytvoření</option>
                <option value="UPDATE">Úprava</option>
                <option value="DELETE">Smazání</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Oblast</label>
              <select
                value={tableFilter}
                onChange={(e) => setTableFilter(e.target.value)}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              >
                <option value="">Vše ({entries.length})</option>
                {tables.map((t) => (
                  <option key={t.name} value={t.name}>
                    {friendlyTable(t.name)} ({t.count})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Od</label>
              <Input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Do</label>
              <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
            </div>
          </div>
          <Button onClick={load} disabled={busy} size="sm" className="mt-3">
            {busy ? 'Načítám…' : 'Aplikovat filtry'}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Záznamy ({entries.length})</CardTitle>
          <CardDescription>Klikni na řádek pro detail (před/po hodnoty).</CardDescription>
        </CardHeader>
        <CardContent>
          {entries.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {busy ? 'Načítám…' : 'Žádné záznamy pro zvolené filtry.'}
            </p>
          ) : (
            <ul className="space-y-1">
              {entries.map((e) => {
                const isOpen = expanded.has(e.id);
                const meta = ACTION_LABELS[e.action];
                return (
                  <li key={e.id} className="rounded-md border">
                    <button
                      type="button"
                      onClick={() => toggleExpand(e.id)}
                      className="flex w-full items-start gap-3 p-3 text-left text-sm hover:bg-muted/40"
                    >
                      {isOpen ? (
                        <ChevronDown className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                      ) : (
                        <ChevronRight className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={`rounded-full px-2 py-0.5 text-xs ${meta?.tone ?? 'bg-slate-100'}`}
                          >
                            {meta?.label ?? e.action}
                          </span>
                          <span className="font-medium">{describeAction(e)}</span>
                          <span className="text-xs text-muted-foreground">
                            {new Date(e.createdAt).toLocaleString('cs-CZ', {
                              dateStyle: 'short',
                              timeStyle: 'short',
                            })}
                          </span>
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {e.actorName ?? e.actorEmail ?? '(systém)'}
                          {e.ipAddress ? ` · ${e.ipAddress}` : ''}
                          {' · '}
                          <code>{e.recordId.slice(0, 8)}…</code>
                        </div>
                      </div>
                    </button>
                    {isOpen ? (
                      <div className="border-t bg-muted/30 p-3 text-xs">
                        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                          <div>
                            <p className="mb-1 font-medium uppercase text-muted-foreground">Před</p>
                            <pre className="overflow-x-auto rounded bg-background p-2">
                              {e.oldValues ? JSON.stringify(e.oldValues, null, 2) : '—'}
                            </pre>
                          </div>
                          <div>
                            <p className="mb-1 font-medium uppercase text-muted-foreground">Po</p>
                            <pre className="overflow-x-auto rounded bg-background p-2">
                              {e.newValues ? JSON.stringify(e.newValues, null, 2) : '—'}
                            </pre>
                          </div>
                        </div>
                        <p className="mt-2 text-[10px] text-muted-foreground">
                          {e.schema}.{e.table} · ID {e.recordId} · log #{e.id}
                        </p>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
