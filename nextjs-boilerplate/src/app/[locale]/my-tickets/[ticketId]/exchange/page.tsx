'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';

interface AvailableEvent {
  id: string;
  title: string;
  date_start: string;
  available_seats_count: number;
}

interface ExchangeData {
  ticketId: string;
  currentEventId: string;
  exchangeFeeHalire: number;
  availableEvents: AvailableEvent[];
}

function authFetch(url: string, init?: RequestInit): Promise<Response> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
  return fetch(url, {
    ...init,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('cs-CZ', {
    weekday: 'short',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function ExchangePage() {
  const params = useParams<{ locale: string; ticketId: string }>();
  const router = useRouter();
  const { locale, ticketId } = params;

  const [data, setData] = useState<ExchangeData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ kind: 'ok' | 'err'; message: string } | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const res = await authFetch(`/api/buyer/tickets/${ticketId}/exchange`);
        if (res.status === 401) {
          setLoadError('Pro výměnu vstupenky se musíš přihlásit.');
          return;
        }
        if (!res.ok) {
          const j = (await res.json().catch(() => ({}))) as { error?: string };
          const msgs: Record<string, string> = {
            TICKET_NOT_FOUND: 'Vstupenka nenalezena.',
            NOT_OWNER: 'Tato vstupenka ti nepatří.',
            TICKET_NOT_VALID: 'Vstupenka není platná.',
            EXCHANGE_DISABLED: 'Pořadatel nepovoluje výměnu termínu pro tuto akci.',
            NO_PRODUCTION: 'Tato akce není součástí žádné produkce s více reprízy.',
          };
          setLoadError(msgs[j.error ?? ''] ?? `Chyba: ${j.error ?? res.status}`);
          return;
        }
        const json = (await res.json()) as ExchangeData;
        setData(json);
      } catch (e) {
        setLoadError((e as Error).message);
      }
    })();
  }, [ticketId]);

  async function doExchange() {
    if (!selectedEventId) return;
    setBusy(true);
    setResult(null);
    try {
      const res = await authFetch(`/api/buyer/tickets/${ticketId}/exchange`, {
        method: 'POST',
        body: JSON.stringify({ targetEventId: selectedEventId }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        newEventTitle?: string;
        newEventDate?: string;
        newSeatInfo?: string | null;
        exchangeFeePaid?: number;
        error?: string;
      };
      if (res.ok && j.success) {
        const feeNote =
          (j.exchangeFeePaid ?? 0) > 0
            ? ` Poplatek za výměnu: ${((j.exchangeFeePaid ?? 0) / 100).toFixed(0)} Kč.`
            : '';
        const seatNote = j.newSeatInfo ? ` Sedadlo: ${j.newSeatInfo}.` : '';
        setResult({
          kind: 'ok',
          message: `Vstupenka přesunuta na ${j.newEventTitle ?? ''}${j.newEventDate ? ` (${formatDate(j.newEventDate)})` : ''}.${seatNote}${feeNote}`,
        });
        setTimeout(() => {
          router.push(`/${locale}/my-tickets`);
        }, 3000);
        return;
      }
      const errMsgs: Record<string, string> = {
        TICKET_NOT_VALID: 'Vstupenka není platná.',
        NOT_OWNER: 'Tato vstupenka ti nepatří.',
        EXCHANGE_DISABLED: 'Výměna termínu není povolena.',
        DIFFERENT_PRODUCTION: 'Cílový termín není ze stejné produkce.',
        TARGET_EVENT_PAST: 'Vybraný termín již proběhl.',
        TARGET_SOLD_OUT: 'Vybraný termín je vyprodaný.',
        SEAT_NOT_AVAILABLE: 'Vybrané sedadlo již není dostupné.',
        TARGET_EVENT_NOT_FOUND: 'Termín nenalezen.',
      };
      setResult({
        kind: 'err',
        message: errMsgs[j.error ?? ''] ?? `Chyba: ${j.error ?? res.status}`,
      });
    } catch (e) {
      setResult({ kind: 'err', message: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  if (loadError) {
    return (
      <div className="mx-auto max-w-xl p-6">
        <div className="rounded-md border border-rose-300 bg-rose-50 p-4 text-sm text-rose-900">
          {loadError}
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="mx-auto max-w-xl p-6">
        <p className="text-sm text-muted-foreground">Načítám dostupné termíny…</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl p-6">
      <h1 className="mb-1 text-2xl font-bold">Výměna termínu</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Vyber nový termín pro přesun vstupenky. Aktuální vstupenka bude zneplatněna a okamžitě
        nahrazena novou na vybraný termín.
        {data.exchangeFeeHalire > 0
          ? ` Poplatek za výměnu: ${(data.exchangeFeeHalire / 100).toFixed(0)} Kč.`
          : ' Výměna je zdarma.'}
      </p>

      {data.availableEvents.length === 0 ? (
        <div className="rounded-md border bg-muted/30 p-6 text-center">
          <p className="text-sm text-muted-foreground">
            Žádné dostupné termíny pro výměnu. Zkus to prosím později nebo kontaktuj pořadatele.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {data.availableEvents.map((ev) => (
            <label
              key={ev.id}
              className={`flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition-colors ${
                selectedEventId === ev.id
                  ? 'border-primary bg-primary/5'
                  : 'hover:border-muted-foreground/40'
              }`}
            >
              <input
                type="radio"
                name="targetEvent"
                value={ev.id}
                checked={selectedEventId === ev.id}
                onChange={() => setSelectedEventId(ev.id)}
                className="mt-0.5"
              />
              <div className="min-w-0 flex-1">
                <div className="font-medium">{ev.title}</div>
                <div className="text-sm text-muted-foreground">{formatDate(ev.date_start)}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {ev.available_seats_count > 0
                    ? `${ev.available_seats_count} ${ev.available_seats_count === 1 ? 'typ volný' : 'typy volné'}`
                    : 'Poslední místa'}
                </div>
              </div>
            </label>
          ))}
        </div>
      )}

      {result ? (
        <div
          className={`mt-4 rounded-md border p-4 text-sm ${
            result.kind === 'ok'
              ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
              : 'border-rose-300 bg-rose-50 text-rose-900'
          }`}
        >
          {result.message}
          {result.kind === 'ok' ? (
            <p className="mt-1 text-xs text-emerald-700">Přesměrovávám na Moje vstupenky…</p>
          ) : null}
        </div>
      ) : null}

      {data.availableEvents.length > 0 && !result ? (
        <div className="mt-6 flex items-center gap-3">
          <Button
            onClick={() => void doExchange()}
            disabled={!selectedEventId || busy}
          >
            {busy ? 'Přesouvám…' : 'Přesunout vstupenku'}
          </Button>
          <Button
            variant="outline"
            onClick={() => router.push(`/${locale}/my-tickets`)}
            disabled={busy}
          >
            Zpět
          </Button>
        </div>
      ) : null}
    </div>
  );
}
