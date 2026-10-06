'use client';

import { useEffect, useState, useRef } from 'react';
import { PageHeader } from '@/components/admin/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { errorText } from '@/lib/ui/error-text';

interface Production {
  id: string;
  title: string;
  slug: string;
  created_at: string;
  event_count: number;
}

interface ProductionEvent {
  id: string;
  title: string;
  date_start: string;
  status: string;
}

interface AllEvent {
  id: string;
  name: string;
  date: string;
}

function adminFetch(url: string, init?: RequestInit): Promise<Response> {
  return fetch(url, { ...init, credentials: 'include', headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } });
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('cs-CZ', { dateStyle: 'short', timeStyle: 'short' });
}

function ManageEventsPanel({
  production,
  onClose,
}: {
  production: Production;
  onClose: () => void;
}) {
  const [linked, setLinked] = useState<ProductionEvent[] | null>(null);
  const [allEvents, setAllEvents] = useState<AllEvent[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadLinked() {
    const res = await adminFetch(`/api/admin/productions/${production.id}/events`);
    if (res.ok) {
      const j = (await res.json()) as { events: ProductionEvent[] };
      setLinked(j.events);
    }
  }

  async function loadAll() {
    const res = await adminFetch('/api/admin/events');
    if (res.ok) {
      const j = (await res.json()) as AllEvent[];
      setAllEvents(j);
    }
  }

  useEffect(() => {
    void loadLinked();
    void loadAll();
  }, [production.id]);

  async function addEvent(eventId: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await adminFetch(`/api/admin/productions/${production.id}/events`, {
        method: 'POST',
        body: JSON.stringify({ eventId }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setError(errorText(j, res.status));
        return;
      }
      await loadLinked();
    } finally {
      setBusy(false);
    }
  }

  async function removeEvent(eventId: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await adminFetch(`/api/admin/productions/${production.id}/events`, {
        method: 'DELETE',
        body: JSON.stringify({ eventId }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setError(errorText(j, res.status));
        return;
      }
      await loadLinked();
    } finally {
      setBusy(false);
    }
  }

  const linkedIds = new Set((linked ?? []).map((e) => e.id));
  const unlinked = (allEvents ?? []).filter((e) => !linkedIds.has(e.id));

  return (
    <div className="mt-4 rounded-lg border bg-muted/30 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-semibold">Reprízy — {production.title}</h3>
        <Button size="sm" variant="outline" onClick={onClose}>
          Zavřít
        </Button>
      </div>

      {error ? (
        <p className="mb-2 text-sm text-rose-700">{error}</p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <p className="mb-2 text-xs font-medium uppercase text-muted-foreground">
            Zařazené reprízy ({linked?.length ?? 0})
          </p>
          {linked === null ? (
            <p className="text-xs text-muted-foreground">Načítám…</p>
          ) : linked.length === 0 ? (
            <p className="text-xs text-muted-foreground">Žádné reprízy ještě nezařazeny.</p>
          ) : (
            <ul className="space-y-1">
              {linked.map((ev) => (
                <li key={ev.id} className="flex items-center justify-between gap-2 rounded border bg-background px-3 py-2 text-sm">
                  <span className="min-w-0 truncate">
                    {ev.title}
                    <span className="ml-1 text-xs text-muted-foreground">{formatDate(ev.date_start)}</span>
                  </span>
                  <button
                    type="button"
                    className="shrink-0 text-xs text-rose-700 hover:underline"
                    disabled={busy}
                    onClick={() => void removeEvent(ev.id)}
                  >
                    Odebrat
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <p className="mb-2 text-xs font-medium uppercase text-muted-foreground">
            Dostupné akce ({unlinked.length})
          </p>
          {allEvents === null ? (
            <p className="text-xs text-muted-foreground">Načítám…</p>
          ) : unlinked.length === 0 ? (
            <p className="text-xs text-muted-foreground">Všechny akce jsou již zařazeny.</p>
          ) : (
            <ul className="space-y-1 max-h-64 overflow-y-auto">
              {unlinked.map((ev) => (
                <li key={ev.id} className="flex items-center justify-between gap-2 rounded border bg-background px-3 py-2 text-sm">
                  <span className="min-w-0 truncate">
                    {ev.name}
                    <span className="ml-1 text-xs text-muted-foreground">{formatDate(ev.date)}</span>
                  </span>
                  <button
                    type="button"
                    className="shrink-0 text-xs text-emerald-700 hover:underline"
                    disabled={busy}
                    onClick={() => void addEvent(ev.id)}
                  >
                    Přidat
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ProductionsPage() {
  const [productions, setProductions] = useState<Production[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [managingId, setManagingId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function load() {
    try {
      const res = await adminFetch('/api/admin/productions');
      if (!res.ok) {
        setLoadError(`Inscenace se nepodařilo načíst. ${errorText({}, res.status)}`);
        return;
      }
      const j = (await res.json()) as { productions: Production[] };
      setProductions(j.productions);
    } catch (e) {
      setLoadError((e as Error).message);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function createProduction() {
    const title = newTitle.trim();
    if (!title) return;
    setCreating(true);
    setCreateError(null);
    try {
      const res = await adminFetch('/api/admin/productions', {
        method: 'POST',
        body: JSON.stringify({ title }),
      });
      const j = (await res.json().catch(() => ({}))) as { production?: Production; error?: string };
      if (!res.ok) {
        setCreateError(errorText(j, res.status));
        return;
      }
      setNewTitle('');
      // Kolo 8: po založení rovnou na kartu inscenace (údaje karty + termíny).
      if (j.production) {
        window.location.href = `/admin/productions/${j.production.id}`;
        return;
      }
      await load();
    } finally {
      setCreating(false);
    }
  }

  const managedProduction = productions?.find((p) => p.id === managingId) ?? null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Inscenace"
        description="Karta představení zadaná jednou (autor, režie, obsazení, délka…) a její termíny v různých městech a sálech. Kupující si může vyměnit termín sám."
      />

      <div className="rounded-lg border bg-card p-4">
        <h3 className="mb-3 text-sm font-semibold">Nová inscenace</h3>
        <div className="flex items-center gap-3">
          <Input
            ref={inputRef}
            placeholder="Název inscenace (např. Racek)"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void createProduction(); }}
            disabled={creating}
            className="max-w-md"
          />
          <Button onClick={() => void createProduction()} disabled={creating || !newTitle.trim()}>
            {creating ? 'Vytvářím…' : 'Vytvořit'}
          </Button>
        </div>
        {createError ? (
          <p className="mt-2 text-sm text-rose-700">{createError}</p>
        ) : null}
      </div>

      {loadError ? (
        <div className="rounded-md border border-rose-300 bg-rose-50 p-4 text-sm text-rose-900">
          {loadError}
        </div>
      ) : productions === null ? (
        <p className="text-sm text-muted-foreground">Načítám…</p>
      ) : productions.length === 0 ? (
        <div className="rounded-md border bg-muted/30 p-6 text-center">
          <p className="text-sm text-muted-foreground">Zatím žádné inscenace. Založte první — napište název nahoře a klikněte na „Vytvořit".</p>
        </div>
      ) : (
        <div className="space-y-3">
          {productions.map((prod) => (
            <div key={prod.id} className="rounded-lg border bg-card p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="font-semibold">{prod.title}</div>
                  <div className="text-xs text-muted-foreground">
                    {prod.event_count} {prod.event_count === 1 ? 'termín' : prod.event_count >= 2 && prod.event_count <= 4 ? 'termíny' : 'termínů'}
                  </div>
                </div>
                <div className="flex gap-2">
                  <a
                    href={`/admin/productions/${prod.id}`}
                    data-testid="open-production"
                    className="inline-flex items-center rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted"
                  >
                    Karta a termíny
                  </a>
                  <Button
                    size="sm"
                    variant={managingId === prod.id ? 'secondary' : 'outline'}
                    onClick={() => setManagingId(managingId === prod.id ? null : prod.id)}
                  >
                    {managingId === prod.id ? 'Zavřít' : 'Připojit existující akce'}
                  </Button>
                </div>
              </div>
              {managingId === prod.id && managedProduction ? (
                <ManageEventsPanel
                  production={managedProduction}
                  onClose={() => setManagingId(null)}
                />
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
