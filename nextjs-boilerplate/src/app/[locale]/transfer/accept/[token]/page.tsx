'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

interface TransferState {
  invitationId: string;
  from: { name: string | null };
  toEmail: string;
  message: string | null;
  expiresAt: string;
  event: {
    title: string;
    date: string;
    venueName: string | null;
  };
}

function authHeaders(): HeadersInit {
  const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
  const userId = typeof window !== 'undefined' ? localStorage.getItem('userId') : null;
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(userId ? { 'x-user-id': userId } : {}),
  };
}

export default function TransferAcceptPage(): JSX.Element {
  const params = useParams<{ token: string; locale: string }>();
  const router = useRouter();
  const [state, setState] = useState<TransferState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [accepted, setAccepted] = useState(false);

  useEffect(() => {
    void load();
  }, [params.token]);

  async function load(): Promise<void> {
    setError(null);
    try {
      const r = await fetch(`/api/transfer/accept/${params.token}`);
      if (!r.ok) {
        const b = (await r.json().catch(() => ({}))) as { error?: string };
        setError(b.error ?? `HTTP ${r.status}`);
        return;
      }
      setState((await r.json()) as TransferState);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Síťová chyba');
    }
  }

  async function accept(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/transfer/accept/${params.token}`, {
        method: 'POST',
        headers: authHeaders(),
      });
      if (!r.ok) {
        const b = (await r.json().catch(() => ({}))) as { error?: string };
        setError(b.error ?? `HTTP ${r.status}`);
        return;
      }
      setAccepted(true);
    } finally {
      setBusy(false);
    }
  }

  const errorMessages: Record<string, string> = {
    INVALID_TOKEN: 'Tento odkaz neexistuje nebo byl zrušen.',
    ALREADY_RESOLVED: 'Tento dárek už byl převzat nebo zrušen.',
    EXPIRED: 'Dárek expiroval (7 dnů od odeslání).',
    MUST_BE_LOGGED_IN: `Pro převzetí se prosím přihlas — buď máš účet, nebo si ho rychle vytvoř.`,
    EMAIL_MISMATCH:
      'Tento odkaz je adresovaný na jiný email. Přihlas se přesně tím emailem, kam dárek přišel.',
    CANT_ACCEPT_OWN_TRANSFER: 'Tento dárek je od tebe — nemůžeš si převzít vlastní transfer.',
  };

  if (error && !state) {
    return (
      <div className="mx-auto mt-12 max-w-md px-4">
        <Card>
          <CardContent className="py-8 text-center">
            <p className="text-sm text-rose-700" data-testid="transfer-error">
              {errorMessages[error] ?? error}
            </p>
            <Button
              variant="outline"
              onClick={() => router.push(`/${params.locale}/events`)}
              className="mt-3"
            >
              Procházet akce
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!state) {
    return (
      <div className="mx-auto mt-12 max-w-md px-4 text-center text-sm text-muted-foreground">
        Načítám…
      </div>
    );
  }

  if (accepted) {
    return (
      <div className="mx-auto mt-12 max-w-md px-4">
        <Card data-testid="transfer-success">
          <CardHeader>
            <CardTitle>🎉 Vstupenka je tvoje!</CardTitle>
            <CardDescription>
              {state.from.name ?? 'Někdo'} ti poslal vstupenku na {state.event.title}.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="rounded-md border bg-muted/30 p-3 text-sm">
              <div>
                <strong>Akce:</strong> {state.event.title}
              </div>
              <div>
                <strong>Kdy:</strong>{' '}
                {new Date(state.event.date).toLocaleString('cs-CZ', {
                  day: 'numeric',
                  month: 'long',
                  year: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </div>
              {state.event.venueName ? (
                <div>
                  <strong>Místo:</strong> {state.event.venueName}
                </div>
              ) : null}
            </div>
            <Button
              onClick={() => router.push(`/${params.locale}/my-tickets`)}
              className="w-full"
            >
              Otevřít moje vstupenky
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto mt-12 max-w-md px-4">
      <Card data-testid="transfer-pending">
        <CardHeader>
          <CardTitle>🎁 Máš tu vstupenku</CardTitle>
          <CardDescription>
            {state.from.name ?? 'Někdo'} ti posílá vstupenku.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="rounded-md border bg-muted/30 p-3 text-sm">
            <div className="font-semibold">{state.event.title}</div>
            <div className="text-muted-foreground">
              {new Date(state.event.date).toLocaleString('cs-CZ', {
                day: 'numeric',
                month: 'long',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </div>
            {state.event.venueName ? (
              <div className="text-muted-foreground">{state.event.venueName}</div>
            ) : null}
          </div>

          {state.message ? (
            <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-sm italic text-blue-900">
              „{state.message}"
            </div>
          ) : null}

          {error ? (
            <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">
              {errorMessages[error] ?? error}
            </div>
          ) : null}

          <p className="text-xs text-muted-foreground">
            Dárek je adresovaný na <strong>{state.toEmail}</strong>. Přihlas
            se prosím tímto emailem.
          </p>

          <Button
            onClick={() => void accept()}
            disabled={busy}
            className="w-full"
            data-testid="accept-button"
          >
            {busy ? 'Převzímám…' : 'Převzít vstupenku'}
          </Button>

          <p className="text-center text-xs text-muted-foreground">
            Platnost odkazu do{' '}
            {new Date(state.expiresAt).toLocaleDateString('cs-CZ', {
              day: 'numeric',
              month: 'long',
            })}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
