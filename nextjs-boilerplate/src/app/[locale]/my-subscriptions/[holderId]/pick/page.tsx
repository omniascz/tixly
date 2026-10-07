'use client';

import { useEffect, useState, type JSX } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';

interface EventOption {
  eventId: string;
  title: string;
  dateStart: string;
  alreadyPicked: boolean;
  ticketId: string | null;
}

interface PickState {
  holderId: string;
  aboType: string;
  maxPicks: number;
  picksUsed: number;
  picksRemaining: number;
  restwertCreditHalire: number;
  pricePaidHalire: number;
  events: EventOption[];
}

function authFetch(url: string, init?: RequestInit): Promise<Response> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
  const userId = typeof window !== 'undefined' ? localStorage.getItem('userId') : null;
  return fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(userId ? { 'x-user-id': userId } : {}),
      ...(init?.headers ?? {}),
    },
  });
}

export default function WahlAboPickPage(): JSX.Element {
  const params = useParams<{ holderId: string; locale: string }>();
  const router = useRouter();
  const [state, setState] = useState<PickState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load(): Promise<void> {
    setError(null);
    try {
      const r = await authFetch(`/api/buyer/subscriptions/${params.holderId}/pick`);
      if (!r.ok) {
        const body = (await r.json().catch(() => ({}))) as { error?: string; message?: string };
        setError(body.message ?? body.error ?? `HTTP ${r.status}`);
        return;
      }
      const body = (await r.json()) as PickState;
      setState(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Síťová chyba');
    }
  }

  useEffect(() => {
    void load();
  }, [params.holderId]);

  async function handlePick(eventId: string): Promise<void> {
    if (!state || state.picksRemaining <= 0) return;
    setBusy(true);
    setError(null);
    try {
      const r = await authFetch(`/api/buyer/subscriptions/${params.holderId}/pick`, {
        method: 'POST',
        body: JSON.stringify({ eventId }),
      });
      if (!r.ok) {
        const body = (await r.json().catch(() => ({}))) as { error?: string; message?: string };
        setError(body.message ?? body.error ?? `HTTP ${r.status}`);
        return;
      }
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function handleCancelPick(eventId: string): Promise<void> {
    if (!state) return;
    if (!window.confirm('Opravdu zrušit tento výběr? Vstupenka bude zneplatněna a získáš zpět kredit.')) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await authFetch(
        `/api/buyer/subscriptions/${params.holderId}/pick/${eventId}`,
        { method: 'DELETE' },
      );
      if (!r.ok) {
        const body = (await r.json().catch(() => ({}))) as { error?: string; message?: string };
        setError(body.message ?? body.error ?? `HTTP ${r.status}`);
        return;
      }
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (error && !state) {
    return (
      <div className="mx-auto mt-12 max-w-2xl px-4">
        <Card>
          <CardContent className="py-8 text-center">
            <p className="text-sm text-rose-700">{error}</p>
            <Button
              variant="outline"
              onClick={() => router.push(`/${params.locale}/my-tickets`)}
              className="mt-3"
            >
              Zpět na moje vstupenky
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!state) {
    return (
      <div className="mx-auto mt-12 max-w-2xl px-4 text-center text-sm text-muted-foreground">
        Načítám…
      </div>
    );
  }

  const done = state.picksRemaining === 0;

  return (
    <div className="mx-auto mt-8 max-w-3xl space-y-4 px-4 pb-12">
      <Card data-testid="wahl-pick-page">
        <CardHeader>
          <CardTitle>Vyberte si představení</CardTitle>
          <CardDescription>
            Vaše abonentka Wahl-Abo: máte zaplaceno&nbsp;
            <strong>{state.maxPicks} představení</strong> z nabídky {state.events.length}.
            {' '}
            {done
              ? 'Všechny výběry už máte vystavené.'
              : `Zbývá vybrat: ${state.picksRemaining}.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="mb-3 flex h-2 overflow-hidden rounded bg-muted">
            <div
              className="bg-primary transition-all"
              style={{ width: `${(state.picksUsed / state.maxPicks) * 100}%` }}
            />
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">
              Použito {state.picksUsed} / {state.maxPicks}
            </span>
            {state.restwertCreditHalire > 0 ? (
              <span
                className="rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-900"
                data-testid="restwert-badge"
                title="Kredit ze zrušených výběrů — uplatníte při dalším nákupu u tohoto pořadatele"
              >
                💰 Restwert kredit:{' '}
                <strong>{(state.restwertCreditHalire / 100).toLocaleString('cs-CZ')} Kč</strong>
              </span>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {error ? (
        <div className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">
          {error}
        </div>
      ) : null}

      <div className="space-y-2">
        {state.events.map((ev) => {
          const picked = ev.alreadyPicked;
          return (
            <Card key={ev.eventId} className={picked ? 'border-emerald-300 bg-emerald-50/50' : ''}>
              <CardContent className="flex items-center justify-between gap-4 py-4">
                <div className="flex-1">
                  <div className="font-medium">{ev.title}</div>
                  <div className="text-xs text-muted-foreground">
                    {new Date(ev.dateStart).toLocaleString('cs-CZ', {
                      day: 'numeric',
                      month: 'long',
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </div>
                </div>
                {picked ? (
                  <div className="flex items-center gap-2">
                    <span className="rounded-full bg-emerald-200 px-3 py-1 text-xs font-medium text-emerald-900">
                      ✓ Vstupenka vystavena
                    </span>
                    <button
                      type="button"
                      onClick={() => void handleCancelPick(ev.eventId)}
                      disabled={busy}
                      className="text-xs text-muted-foreground underline hover:text-rose-700"
                      data-testid={`cancel-pick-${ev.eventId}`}
                      title="Zrušit výběr a získat zpět kredit"
                    >
                      Zrušit
                    </button>
                  </div>
                ) : done ? (
                  <span className="text-xs text-muted-foreground">limit vyčerpán</span>
                ) : (
                  <Button
                    size="sm"
                    onClick={() => void handlePick(ev.eventId)}
                    disabled={busy}
                    data-testid={`pick-event-${ev.eventId}`}
                  >
                    {busy ? '…' : 'Vybrat'}
                  </Button>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {done ? (
        <div className="text-center">
          <Button
            onClick={() => router.push(`/${params.locale}/my-tickets`)}
            className="mt-4"
          >
            Pokračovat na moje vstupenky
          </Button>
        </div>
      ) : null}
    </div>
  );
}
