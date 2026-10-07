'use client';

import { useEffect, useState, type JSX } from 'react';
import { useParams } from 'next/navigation';
import { PageHeader } from '@/components/admin/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

interface SeatRow {
  eventSeatId: string;
  sector: string;
  row: string;
  seatNumber: string;
  photoUrl: string | null;
  thumbnailUrl: string | null;
  caption: string | null;
  capturedAt: string | null;
}

interface State {
  total: number;
  withPhoto: number;
  withoutPhoto: number;
  seats: SeatRow[];
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

export default function ViewPhotosPage(): JSX.Element {
  const params = useParams<{ id: string }>();
  const eventId = params.id;

  const [state, setState] = useState<State | null>(null);
  const [draft, setDraft] = useState<Record<string, { url: string; caption: string }>>({});
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<'all' | 'missing' | 'with'>('all');

  async function load(): Promise<void> {
    setError(null);
    try {
      const r = await authFetch(`/api/admin/events/${eventId}/view-photos`);
      if (!r.ok) {
        setError(`HTTP ${r.status}`);
        return;
      }
      const data = (await r.json()) as State;
      setState(data);
      setDraft({});
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Síťová chyba');
    }
  }

  useEffect(() => {
    void load();
  }, [eventId]);

  function setDraftField(seatId: string, field: 'url' | 'caption', value: string): void {
    setDraft((d) => ({
      ...d,
      [seatId]: { ...(d[seatId] ?? { url: '', caption: '' }), [field]: value },
    }));
  }

  async function save(): Promise<void> {
    const photos = Object.entries(draft)
      .filter(([, v]) => v.url.trim().length > 0)
      .map(([eventSeatId, v]) => ({
        eventSeatId,
        photoUrl: v.url.trim(),
        caption: v.caption.trim() || undefined,
      }));
    if (photos.length === 0) {
      setError('Žádné foto URL nebylo zadáno.');
      return;
    }
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const r = await authFetch(`/api/admin/events/${eventId}/view-photos`, {
        method: 'POST',
        body: JSON.stringify({ photos }),
      });
      if (!r.ok) {
        const b = (await r.json().catch(() => ({}))) as { error?: string; message?: string };
        setError(b.message ?? b.error ?? `HTTP ${r.status}`);
        return;
      }
      const b = (await r.json()) as { upserted: number };
      setSuccess(`Uloženo ${b.upserted} fotek pohledu.`);
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (!state) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        {error ?? 'Načítám…'}
      </div>
    );
  }

  const visibleSeats = state.seats.filter((s) => {
    if (filter === 'missing') return s.photoUrl === null;
    if (filter === 'with') return s.photoUrl !== null;
    return true;
  });

  const draftCount = Object.values(draft).filter((v) => v.url.trim()).length;

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Click & View — pohled ze sedadla"
        description="Nahraj fotku pohledu z konkrétního sedadla. Buyer ji uvidí při výběru sedadla v seat picker UI. Reservix exclusive feature, žádná česká platforma to nemá."
      />

      <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
        <strong>📸 MVP režim — URL paste:</strong> Nahraj foto na Cloudinary, imgur,
        nebo Vercel Blob a vlož sem URL. V produkci bude direct upload přes
        mobile capture (Reservix model).
      </div>

      {error ? (
        <div className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">
          {error}
        </div>
      ) : null}
      {success ? (
        <div className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">
          {success}
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Stav fotek</CardTitle>
          <CardDescription>
            {state.withPhoto} / {state.total} sedadel má foto pohledu.
            {state.withoutPhoto > 0
              ? ` ${state.withoutPhoto} chybí.`
              : ' Vše hotové.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex h-2 overflow-hidden rounded bg-muted">
            <div
              className="bg-primary"
              style={{
                width: `${state.total > 0 ? (state.withPhoto / state.total) * 100 : 0}%`,
              }}
            />
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setFilter('all')}
              className={`rounded-md border px-3 py-1 text-xs ${filter === 'all' ? 'border-primary bg-primary text-primary-foreground' : ''}`}
            >
              Vše ({state.total})
            </button>
            <button
              type="button"
              onClick={() => setFilter('missing')}
              className={`rounded-md border px-3 py-1 text-xs ${filter === 'missing' ? 'border-primary bg-primary text-primary-foreground' : ''}`}
            >
              Bez foto ({state.withoutPhoto})
            </button>
            <button
              type="button"
              onClick={() => setFilter('with')}
              className={`rounded-md border px-3 py-1 text-xs ${filter === 'with' ? 'border-primary bg-primary text-primary-foreground' : ''}`}
            >
              S fotem ({state.withPhoto})
            </button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Sedadla</CardTitle>
          <CardDescription>
            Pro každé sedadlo vyplň URL fotky pohledu. Změny ulož jedním
            kliknutím dole. Hover na náhled v buyer UI = preview.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {visibleSeats.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Žádné sedadlo pro tento filtr.
              </p>
            ) : (
              visibleSeats.slice(0, 100).map((s) => {
                const currentUrl = draft[s.eventSeatId]?.url ?? s.photoUrl ?? '';
                const currentCaption =
                  draft[s.eventSeatId]?.caption ?? s.caption ?? '';
                return (
                  <div
                    key={s.eventSeatId}
                    className="flex items-center gap-3 rounded-md border p-2"
                    data-testid={`seat-row-${s.sector}-${s.row}-${s.seatNumber}`}
                  >
                    <div className="w-24 shrink-0 text-xs font-mono">
                      {s.sector} · {s.row}/{s.seatNumber}
                    </div>
                    {s.photoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={s.thumbnailUrl ?? s.photoUrl}
                        alt={`Pohled ze sedadla ${s.row}/${s.seatNumber}`}
                        className="h-12 w-16 rounded border object-cover"
                      />
                    ) : (
                      <div className="grid h-12 w-16 place-items-center rounded border bg-muted text-xs text-muted-foreground">
                        ∅
                      </div>
                    )}
                    <Input
                      placeholder="https://… (URL fotky)"
                      value={currentUrl}
                      onChange={(e) =>
                        setDraftField(s.eventSeatId, 'url', e.target.value)
                      }
                      className="flex-1"
                      data-testid={`url-${s.eventSeatId}`}
                    />
                    <Input
                      placeholder="popis (volitelné)"
                      value={currentCaption}
                      onChange={(e) =>
                        setDraftField(s.eventSeatId, 'caption', e.target.value)
                      }
                      className="max-w-[200px]"
                    />
                  </div>
                );
              })
            )}
          </div>
          {visibleSeats.length > 100 ? (
            <p className="mt-3 text-xs text-muted-foreground">
              Zobrazeno prvních 100 z {visibleSeats.length}. Použij filtr.
            </p>
          ) : null}
          <div className="mt-4 flex items-center justify-between border-t pt-3">
            <p className="text-sm text-muted-foreground">
              {draftCount > 0 ? `${draftCount} změn k uložení` : 'Žádné nové změny'}
            </p>
            <Button
              onClick={() => void save()}
              disabled={busy || draftCount === 0}
              data-testid="save-photos"
            >
              {busy ? 'Ukládám…' : 'Uložit fotky'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
