'use client';

import { useState } from 'react';
import Image from 'next/image';
import { Shield, ChevronRight, X } from 'lucide-react';

const SCOPE_LABELS: Record<string, string> = {
  read_events: 'Číst seznam akcí',
  write_events: 'Vytvářet a upravovat akce',
  read_orders: 'Číst objednávky a tržby',
  write_orders: 'Spravovat objednávky',
  read_attendees: 'Číst seznam účastníků',
  read_tickets: 'Číst informace o lístcích',
  manage_webhooks: 'Spravovat webhooks',
};

interface Props {
  clientId: string;
  clientPublicId: string;
  appName: string;
  appLogoUrl: string | null;
  userEmail: string;
  userId: string;
  promoterId: string | null;
  requestedScopes: string[];
  redirectUri: string;
  state: string;
  codeChallenge: string;
  codeChallengeMethod: string;
}

export function ConsentForm(props: Props): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function decision(approve: boolean): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      if (!approve) {
        const url = `${props.redirectUri}?error=access_denied&state=${encodeURIComponent(props.state)}`;
        window.location.href = url;
        return;
      }
      const r = await fetch('/api/oauth/authorize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientPkId: props.clientId,
          redirectUri: props.redirectUri,
          scopes: props.requestedScopes,
          codeChallenge: props.codeChallenge || undefined,
          codeChallengeMethod: props.codeChallengeMethod || undefined,
        }),
      });
      if (!r.ok) {
        const e = await r.json() as { error?: string };
        throw new Error(e.error ?? `HTTP ${r.status}`);
      }
      const data = await r.json() as { code: string };
      const url = `${props.redirectUri}?code=${data.code}&state=${encodeURIComponent(props.state)}`;
      window.location.href = url;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Chyba');
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-md p-8">
      <div className="rounded-lg border bg-card p-6 shadow-sm">
        <div className="mb-6 flex items-center gap-4">
          {props.appLogoUrl ? (
            <Image src={props.appLogoUrl} alt={props.appName} width={48} height={48} className="rounded-lg" />
          ) : (
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
              <Shield className="h-6 w-6 text-primary" />
            </div>
          )}
          <div className="flex-1">
            <h1 className="text-lg font-bold">{props.appName}</h1>
            <p className="text-xs text-muted-foreground">žádá přístup k tvému Tixly účtu</p>
          </div>
        </div>

        <div className="mb-4 rounded-md bg-muted/50 p-3">
          <p className="text-xs text-muted-foreground">Přihlášen jako:</p>
          <p className="text-sm font-medium">{props.userEmail}</p>
        </div>

        <p className="mb-3 text-sm font-medium">Tato aplikace bude moci:</p>
        <ul className="mb-6 space-y-2">
          {props.requestedScopes.map((s) => (
            <li key={s} className="flex items-start gap-2 text-sm">
              <ChevronRight className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-600" />
              <span>{SCOPE_LABELS[s] ?? s}</span>
            </li>
          ))}
        </ul>

        {error ? (
          <div className="mb-4 rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">{error}</div>
        ) : null}

        <div className="space-y-2">
          <button
            type="button"
            onClick={() => decision(true)}
            disabled={busy}
            className="w-full rounded-md bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {busy ? 'Zpracovávám…' : 'Povolit přístup'}
          </button>
          <button
            type="button"
            onClick={() => decision(false)}
            disabled={busy}
            className="flex w-full items-center justify-center gap-2 rounded-md border px-4 py-3 text-sm hover:bg-muted/30"
          >
            <X className="h-4 w-4" /> Zamítnout
          </button>
        </div>

        <p className="mt-4 text-center text-xs text-muted-foreground">
          Přístup můžeš kdykoliv odvolat v Nastavení → Připojené aplikace.
        </p>
      </div>
    </div>
  );
}
