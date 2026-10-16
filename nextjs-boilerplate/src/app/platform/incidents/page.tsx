'use client';

import { useEffect, useState, type JSX } from 'react';
import { AlertOctagon } from 'lucide-react';

interface Incident {
  id: string;
  title: string;
  description: string | null;
  status: 'investigating' | 'identified' | 'monitoring' | 'resolved';
  severity: 'minor' | 'major' | 'critical';
  affected_services: string[];
  is_public: boolean;
  started_at: string;
  resolved_at: string | null;
}

const STATUS_TONE: Record<string, string> = {
  investigating: 'bg-amber-100 text-amber-900',
  identified: 'bg-orange-100 text-orange-900',
  monitoring: 'bg-sky-100 text-sky-900',
  resolved: 'bg-emerald-100 text-emerald-900',
};

const SEVERITY_TONE: Record<string, string> = {
  minor: 'bg-slate-100 text-slate-700',
  major: 'bg-orange-100 text-orange-800',
  critical: 'bg-rose-100 text-rose-800',
};

function authFetch(url: string, init?: RequestInit): Promise<Response> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
  return fetch(url, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
}

export default function IncidentsPage(): JSX.Element {
  const [items, setItems] = useState<Incident[]>([]);
  const [busy, setBusy] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [draft, setDraft] = useState({
    title: '',
    description: '',
    status: 'investigating' as Incident['status'],
    severity: 'minor' as Incident['severity'],
    affectedServices: '',
    isPublic: true,
  });

  async function load(): Promise<void> {
    setBusy(true);
    try {
      const r = await authFetch('/api/platform/incidents');
      if (r.ok) {
        const data = (await r.json()) as { items: Incident[] };
        setItems(data.items);
      }
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function createIncident(): Promise<void> {
    if (!draft.title.trim()) return;
    const r = await authFetch('/api/platform/incidents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: draft.title.trim(),
        description: draft.description.trim() || undefined,
        status: draft.status,
        severity: draft.severity,
        affectedServices: draft.affectedServices
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        isPublic: draft.isPublic,
      }),
    });
    if (r.ok) {
      setShowNew(false);
      setDraft({
        title: '',
        description: '',
        status: 'investigating',
        severity: 'minor',
        affectedServices: '',
        isPublic: true,
      });
      void load();
    }
  }

  async function quickStatusChange(id: string, status: Incident['status']): Promise<void> {
    await authFetch(`/api/platform/incidents/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    void load();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">Incidenty</h1>
          <p className="text-sm text-muted-foreground">
            Publikované incidenty se zobrazí na <code>/cs/status</code>.
            Auditní zápis i pro is_public=false (interní).
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowNew((v) => !v)}
          className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground hover:bg-primary/90"
        >
          {showNew ? 'Zrušit' : '+ Nový incident'}
        </button>
      </div>

      {showNew ? (
        <div className="space-y-3 rounded-lg border bg-card p-4">
          <div>
            <label className="mb-1 block text-xs font-medium">Titulek</label>
            <input
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              placeholder="Pomalé načítání checkout stránky"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium">Popis</label>
            <textarea
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              rows={3}
              className="w-full rounded-md border border-input bg-background p-2 text-sm"
              placeholder="Co se děje, koho to ovlivňuje, ETA fix."
            />
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <div>
              <label className="mb-1 block text-xs font-medium">Status</label>
              <select
                value={draft.status}
                onChange={(e) => setDraft({ ...draft, status: e.target.value as Incident['status'] })}
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              >
                <option value="investigating">Investigating</option>
                <option value="identified">Identified</option>
                <option value="monitoring">Monitoring</option>
                <option value="resolved">Resolved</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Severity</label>
              <select
                value={draft.severity}
                onChange={(e) => setDraft({ ...draft, severity: e.target.value as Incident['severity'] })}
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              >
                <option value="minor">Minor</option>
                <option value="major">Major</option>
                <option value="critical">Critical</option>
              </select>
            </div>
            <div className="col-span-2">
              <label className="mb-1 block text-xs font-medium">
                Affected services (comma-separated)
              </label>
              <input
                value={draft.affectedServices}
                onChange={(e) => setDraft({ ...draft, affectedServices: e.target.value })}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                placeholder="Checkout, GoPay"
              />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={draft.isPublic}
              onChange={(e) => setDraft({ ...draft, isPublic: e.target.checked })}
            />
            Veřejně viditelný na status page
          </label>
          <button
            type="button"
            onClick={createIncident}
            className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground hover:bg-primary/90"
          >
            Publikovat
          </button>
        </div>
      ) : null}

      {busy && items.length === 0 ? (
        <p className="text-sm text-muted-foreground">Načítám…</p>
      ) : items.length === 0 ? (
        <div className="rounded-lg border bg-card py-12 text-center text-muted-foreground">
          <AlertOctagon className="mx-auto mb-3 h-8 w-8 opacity-30" />
          <p>Žádné incidenty zatím nebyly publikovány.</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {items.map((inc) => (
            <li key={inc.id} className="rounded-lg border bg-card p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_TONE[inc.status]}`}
                    >
                      {inc.status}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${SEVERITY_TONE[inc.severity]}`}
                    >
                      {inc.severity}
                    </span>
                    {!inc.is_public ? (
                      <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs">
                        interní
                      </span>
                    ) : null}
                    <span className="font-medium">{inc.title}</span>
                  </div>
                  {inc.description ? (
                    <p className="mt-1 text-sm text-muted-foreground">{inc.description}</p>
                  ) : null}
                  <p className="mt-1 text-xs text-muted-foreground">
                    {new Date(inc.started_at).toLocaleString('cs-CZ')}
                    {inc.resolved_at
                      ? ` → vyřešeno ${new Date(inc.resolved_at).toLocaleString('cs-CZ')}`
                      : ''}
                    {inc.affected_services?.length
                      ? ` · ${inc.affected_services.join(', ')}`
                      : ''}
                  </p>
                </div>
                {inc.status !== 'resolved' ? (
                  <button
                    type="button"
                    onClick={() => quickStatusChange(inc.id, 'resolved')}
                    className="rounded-md border px-3 py-1 text-xs hover:bg-emerald-50"
                  >
                    Označit jako vyřešený
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
