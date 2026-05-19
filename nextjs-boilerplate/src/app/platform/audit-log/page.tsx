'use client';

import { useEffect, useState } from 'react';

interface LogItem {
  id: string;
  eventId: string;
  eventTitle: string | null;
  actorEmail: string | null;
  actorType: 'auto_keyword' | 'auto_ai' | 'human';
  decision: 'submitted' | 'approved' | 'rejected' | 'flagged';
  reason: string | null;
  matchedKeywords: string[] | null;
  aiScore: number | null;
  aiCategories: string[] | null;
  createdAt: string;
}

const DECISION_TONE: Record<string, string> = {
  submitted: 'bg-amber-100 text-amber-800',
  approved: 'bg-emerald-100 text-emerald-800',
  rejected: 'bg-rose-100 text-rose-800',
  flagged: 'bg-orange-100 text-orange-800',
};

const ACTOR_TONE: Record<string, string> = {
  auto_keyword: 'bg-slate-100 text-slate-700',
  auto_ai: 'bg-violet-100 text-violet-800',
  human: 'bg-blue-100 text-blue-800',
};

const PAGE_SIZE = 50;

export default function AuditLogPage() {
  const [items, setItems] = useState<LogItem[]>([]);
  const [total, setTotal] = useState(0);
  const [decision, setDecision] = useState('');
  const [actorType, setActorType] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);

  function buildParams(): URLSearchParams {
    const params = new URLSearchParams();
    if (decision) params.set('decision', decision);
    if (actorType) params.set('actorType', actorType);
    if (fromDate) params.set('from', new Date(fromDate).toISOString());
    if (toDate) {
      const t = new Date(toDate);
      t.setDate(t.getDate() + 1);
      params.set('to', t.toISOString());
    }
    return params;
  }

  async function load() {
    setLoading(true);
    try {
      const params = buildParams();
      params.set('limit', String(PAGE_SIZE));
      params.set('offset', String(offset));
      const token = localStorage.getItem('accessToken');
      const r = await fetch(`/api/platform/audit-log?${params.toString()}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (r.ok) {
        const data = (await r.json()) as { items: LogItem[]; total: number };
        setItems(data.items);
        setTotal(data.total);
      }
    } finally {
      setLoading(false);
    }
  }

  function downloadCsv(): void {
    const params = buildParams();
    params.set('format', 'csv');
    const token = localStorage.getItem('accessToken');
    void fetch(`/api/platform/audit-log?${params.toString()}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then((r) => r.blob())
      .then((blob) => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `moderation-log-${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(a.href);
      });
  }

  useEffect(() => {
    void load();
  }, [decision, actorType, fromDate, toDate, offset]);

  // Reset offset když změním filtr
  useEffect(() => {
    setOffset(0);
  }, [decision, actorType, fromDate, toDate]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Audit log moderation</h1>
        <p className="text-sm text-muted-foreground">
          DSA legal trail — všechna automatická i manuální rozhodnutí o akcích.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-md border bg-card p-3">
        <div>
          <label className="mb-1 block text-xs font-medium">Rozhodnutí</label>
          <select
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            value={decision}
            onChange={(e) => setDecision(e.target.value)}
          >
            <option value="">— vše —</option>
            <option value="submitted">Submitted</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="flagged">Flagged</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium">Aktér</label>
          <select
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            value={actorType}
            onChange={(e) => setActorType(e.target.value)}
          >
            <option value="">— vše —</option>
            <option value="auto_keyword">Auto: keyword</option>
            <option value="auto_ai">Auto: AI</option>
            <option value="human">Human</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium">Od</label>
          <input
            type="date"
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium">Do</label>
          <input
            type="date"
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
          />
        </div>
        <button
          type="button"
          onClick={downloadCsv}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm hover:bg-muted"
        >
          Export CSV
        </button>
        <div className="ml-auto self-end text-xs text-muted-foreground">
          {loading ? 'Načítám…' : `Záznamů: ${total}`}
        </div>
      </div>

      {total > PAGE_SIZE ? (
        <div className="flex items-center justify-end gap-2 text-sm">
          <button
            type="button"
            onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            disabled={offset === 0 || loading}
            className="rounded-md border px-3 py-1 disabled:opacity-50"
          >
            ← Předchozí
          </button>
          <span className="text-xs text-muted-foreground">
            {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} z {total}
          </span>
          <button
            type="button"
            onClick={() => setOffset(offset + PAGE_SIZE)}
            disabled={offset + PAGE_SIZE >= total || loading}
            className="rounded-md border px-3 py-1 disabled:opacity-50"
          >
            Další →
          </button>
        </div>
      ) : null}

      <div className="rounded-md border bg-card">
        {items.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">
            Žádné záznamy.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                <th className="px-3 py-2">Čas</th>
                <th>Akce</th>
                <th>Aktér</th>
                <th>Rozhodnutí</th>
                <th>Důvod</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id} className="border-b align-top">
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {new Date(it.createdAt).toLocaleString('cs-CZ')}
                  </td>
                  <td>
                    <div className="font-medium">{it.eventTitle ?? '—'}</div>
                    <div className="text-xs text-muted-foreground">
                      {it.eventId.slice(0, 8)}
                    </div>
                  </td>
                  <td>
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${ACTOR_TONE[it.actorType] ?? 'bg-slate-100'}`}
                    >
                      {it.actorType}
                    </span>
                    {it.actorEmail ? (
                      <div className="mt-1 text-xs text-muted-foreground">
                        {it.actorEmail}
                      </div>
                    ) : null}
                  </td>
                  <td>
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${DECISION_TONE[it.decision] ?? 'bg-slate-100'}`}
                    >
                      {it.decision}
                    </span>
                  </td>
                  <td className="max-w-md text-xs">
                    {it.reason ? (
                      <p className="text-muted-foreground">{it.reason}</p>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                    {it.matchedKeywords && it.matchedKeywords.length > 0 ? (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {it.matchedKeywords.map((k) => (
                          <span
                            key={k}
                            className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-mono text-slate-700"
                          >
                            {k}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
