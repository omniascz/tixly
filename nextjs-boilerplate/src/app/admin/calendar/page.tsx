'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { PageHeader } from '@/components/admin/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

interface HoldRow {
  id: string;
  venueId: string;
  venueName: string;
  date: string;
  optionRank: number;
  title: string;
  artistName: string | null;
  expiresAt: string | null;
  status: 'held' | 'confirmed';
  eventId: string | null;
}

interface EventRow {
  id: string;
  title: string;
  date: string;
  venueId: string | null;
  venueName: string | null;
}

interface Venue {
  id: string;
  name: string;
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

function monthRange(year: number, month: number): { from: string; to: string; days: string[] } {
  const first = new Date(Date.UTC(year, month, 1));
  const last = new Date(Date.UTC(year, month + 1, 0));
  const days: string[] = [];
  for (let d = 1; d <= last.getUTCDate(); d++) {
    days.push(new Date(Date.UTC(year, month, d)).toISOString().slice(0, 10));
  }
  return {
    from: first.toISOString().slice(0, 10),
    to: last.toISOString().slice(0, 10),
    days,
  };
}

const MONTHS = [
  'leden', 'únor', 'březen', 'duben', 'květen', 'červen',
  'červenec', 'srpen', 'září', 'říjen', 'listopad', 'prosinec',
];

export default function CalendarPage() {
  const now = new Date();
  const [year, setYear] = useState(now.getUTCFullYear());
  const [month, setMonth] = useState(now.getUTCMonth());

  const [holds, setHolds] = useState<HoldRow[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [venues, setVenues] = useState<Venue[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // Nová opce
  const [venueId, setVenueId] = useState('');
  const [holdDate, setHoldDate] = useState('');
  const [title, setTitle] = useState('');
  const [artistName, setArtistName] = useState('');
  const [expiresAt, setExpiresAt] = useState('');

  const range = useMemo(() => monthRange(year, month), [year, month]);

  const load = useCallback(async (): Promise<void> => {
    try {
      const res = await authFetch(`/api/admin/date-holds?from=${range.from}&to=${range.to}`);
      if (!res.ok) {
        setError(`Nepodařilo se načíst kalendář (HTTP ${res.status}).`);
        return;
      }
      const j = (await res.json()) as { holds: HoldRow[]; events: EventRow[] };
      setHolds(j.holds);
      setEvents(j.events);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [range.from, range.to]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void (async () => {
      const res = await authFetch('/api/admin/venues');
      if (!res.ok) return;
      const j = (await res.json()) as { venues?: Venue[] } | Venue[];
      const list = Array.isArray(j) ? j : (j.venues ?? []);
      setVenues(list);
      if (list.length > 0) setVenueId((v) => v || list[0].id);
    })();
  }, []);

  async function createHold(): Promise<void> {
    if (!venueId || !holdDate || !title.trim()) {
      setError('Vyplň sál, datum a název.');
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await authFetch('/api/admin/date-holds', {
        method: 'POST',
        body: JSON.stringify({
          venueId,
          holdDate,
          title: title.trim(),
          artistName: artistName.trim() || undefined,
          expiresAt: expiresAt ? new Date(expiresAt).toISOString() : undefined,
        }),
      });
      const j = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
      if (!res.ok) {
        setError(j.message ?? j.error ?? `Nepodařilo se uložit (HTTP ${res.status}).`);
        return;
      }
      setMessage(j.message ?? 'Opce založena.');
      setTitle('');
      setArtistName('');
      setExpiresAt('');
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function confirmHold(id: string): Promise<void> {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await authFetch(`/api/admin/date-holds/${id}/confirm`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      const j = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
      if (!res.ok) {
        setError(j.message ?? j.error ?? `Nepodařilo se potvrdit (HTTP ${res.status}).`);
        return;
      }
      setMessage(j.message ?? 'Termín potvrzen.');
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function releaseHold(id: string): Promise<void> {
    if (!confirm('Opravdu pustit tuhle opci? Termín se uvolní dalšímu v pořadí.')) return;
    setBusy(true);
    try {
      const res = await authFetch(`/api/admin/date-holds/${id}`, { method: 'DELETE' });
      const j = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
      if (!res.ok) {
        setError(j.message ?? j.error ?? `Nepodařilo se uvolnit (HTTP ${res.status}).`);
        return;
      }
      setMessage(j.message ?? 'Opce uvolněna.');
      await load();
    } finally {
      setBusy(false);
    }
  }

  const byDate = useMemo(() => {
    const map = new Map<string, { holds: HoldRow[]; events: EventRow[] }>();
    for (const d of range.days) map.set(d, { holds: [], events: [] });
    for (const h of holds) map.get(h.date)?.holds.push(h);
    for (const e of events) map.get(e.date)?.events.push(e);
    return map;
  }, [holds, events, range.days]);

  function shiftMonth(delta: number): void {
    const d = new Date(Date.UTC(year, month + delta, 1));
    setYear(d.getUTCFullYear());
    setMonth(d.getUTCMonth());
  }

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Kalendář a opce na termíny"
        description="Držené termíny v sálech a potvrzené akce. Opce sama akci nezakládá — ta vznikne až potvrzením."
      />

      <Card>
        <CardContent className="space-y-3 p-4">
          <h2 className="text-sm font-semibold">Držet termín</h2>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
            <div>
              <label className="mb-1 block text-xs font-medium">Sál</label>
              <select
                value={venueId}
                onChange={(e) => setVenueId(e.target.value)}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              >
                {venues.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Datum</label>
              <Input type="date" value={holdDate} onChange={(e) => setHoldDate(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Název</label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Podzimní turné" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Umělec</label>
              <Input value={artistName} onChange={(e) => setArtistName(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Potvrdit do</label>
              <Input
                type="datetime-local"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
              />
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Bez lhůty opce drží, dokud ji nepustíš. S lhůtou po jejím uplynutí propadne a posune se
            další v pořadí.
          </p>
          <Button onClick={createHold} disabled={busy}>
            {busy ? 'Ukládám…' : 'Držet termín'}
          </Button>
        </CardContent>
      </Card>

      {error ? (
        <div className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">
          {error}
        </div>
      ) : null}
      {message ? (
        <div className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">
          {message}
        </div>
      ) : null}

      <div className="flex items-center justify-between">
        <Button variant="outline" size="sm" onClick={() => shiftMonth(-1)}>
          ← předchozí
        </Button>
        <h2 className="text-lg font-semibold">
          {MONTHS[month]} {year}
        </h2>
        <Button variant="outline" size="sm" onClick={() => shiftMonth(1)}>
          další →
        </Button>
      </div>

      <div className="space-y-1">
        {range.days.map((d) => {
          const cell = byDate.get(d);
          const hasAnything = (cell?.holds.length ?? 0) > 0 || (cell?.events.length ?? 0) > 0;
          if (!hasAnything) return null;
          const day = new Date(`${d}T00:00:00Z`);
          return (
            <div key={d} className="rounded-md border bg-card p-3">
              <div className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
                {day.getUTCDate()}. {MONTHS[day.getUTCMonth()]}
              </div>
              <div className="space-y-2">
                {cell?.holds.map((h) => (
                  <div key={h.id} className="flex flex-wrap items-center gap-2 text-sm">
                    <span
                      className={`rounded px-2 py-0.5 text-xs ${
                        h.status === 'confirmed'
                          ? 'bg-emerald-100 text-emerald-900'
                          : h.optionRank === 1
                            ? 'bg-amber-100 text-amber-900'
                            : 'bg-slate-100 text-slate-700'
                      }`}
                    >
                      {h.status === 'confirmed' ? 'potvrzeno' : `${h.optionRank}. opce`}
                    </span>
                    <span className="font-medium">{h.title}</span>
                    {h.artistName ? (
                      <span className="text-muted-foreground">· {h.artistName}</span>
                    ) : null}
                    <span className="text-muted-foreground">· {h.venueName}</span>
                    {h.expiresAt && h.status === 'held' ? (
                      <span className="text-xs text-muted-foreground">
                        potvrdit do {new Date(h.expiresAt).toLocaleDateString('cs-CZ')}
                      </span>
                    ) : null}
                    {h.status === 'held' ? (
                      <span className="ml-auto flex gap-3">
                        <button
                          type="button"
                          onClick={() => void confirmHold(h.id)}
                          disabled={busy}
                          className="text-xs text-emerald-700 hover:underline"
                        >
                          Potvrdit
                        </button>
                        <button
                          type="button"
                          onClick={() => void releaseHold(h.id)}
                          disabled={busy}
                          className="text-xs text-rose-700 hover:underline"
                        >
                          Pustit
                        </button>
                      </span>
                    ) : null}
                  </div>
                ))}
                {cell?.events.map((e) => (
                  <div key={e.id} className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="rounded bg-blue-100 px-2 py-0.5 text-xs text-blue-900">akce</span>
                    <a href={`/admin/events/${e.id}`} className="font-medium hover:underline">
                      {e.title}
                    </a>
                    {e.venueName ? (
                      <span className="text-muted-foreground">· {e.venueName}</span>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
        {holds.length === 0 && events.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center text-sm text-muted-foreground">
              V tomhle měsíci nemáš držený ani potvrzený žádný termín.
            </CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
