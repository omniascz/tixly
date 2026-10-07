'use client';

import { useEffect, useState, type JSX } from 'react';
import { Shield, Trash2, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface ConnectedApp {
  client_id: string;
  app_name: string;
  app_description: string | null;
  app_logo_url: string | null;
  scopes: string[];
  last_used_at: string | null;
  granted_at: string;
}

function authFetch(url: string, init?: RequestInit): Promise<Response> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
  return fetch(url, {
    ...init, credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
}

const SCOPE_LABELS: Record<string, string> = {
  read_events: 'Číst akce',
  write_events: 'Vytvářet/upravovat akce',
  read_orders: 'Číst objednávky',
  write_orders: 'Spravovat objednávky',
  read_attendees: 'Číst seznam účastníků',
  read_tickets: 'Číst lístky',
  manage_webhooks: 'Spravovat webhooks',
};

export function ConnectedAppsClient({ locale: _locale }: { locale: string }): JSX.Element {
  const [apps, setApps] = useState<ConnectedApp[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { void load(); }, []);

  async function load(): Promise<void> {
    try {
      const r = await authFetch('/api/buyer/connected-apps');
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json() as { apps: ConnectedApp[] };
      setApps(data.apps);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Chyba');
    }
  }

  async function revoke(clientId: string, appName: string): Promise<void> {
    if (!confirm(`Odvolat přístup pro ${appName}? Aplikace okamžitě ztratí přístup ke všem tvým datům.`)) return;
    try {
      const r = await authFetch(`/api/buyer/connected-apps?clientId=${clientId}`, { method: 'DELETE' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Chyba');
    }
  }

  if (error) {
    return <div className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">{error}</div>;
  }
  if (!apps) return <p className="text-sm text-muted-foreground">Načítám…</p>;

  if (apps.length === 0) {
    return (
      <div className="rounded-md border bg-muted/30 p-8 text-center">
        <Shield className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          Žádné připojené aplikace. Když nějakou připojíš (např. „Sign in with Tixly" v cizí app),
          objeví se zde.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {apps.map((app) => (
        <div key={app.client_id} className="rounded-lg border bg-card p-4">
          <div className="flex items-start gap-3">
            {app.app_logo_url ? (
              <img src={app.app_logo_url} alt={app.app_name} className="h-12 w-12 rounded-md" />
            ) : (
              <div className="flex h-12 w-12 items-center justify-center rounded-md bg-primary/10">
                <Shield className="h-6 w-6 text-primary" />
              </div>
            )}
            <div className="flex-1">
              <p className="font-semibold">{app.app_name}</p>
              {app.app_description ? (
                <p className="text-sm text-muted-foreground">{app.app_description}</p>
              ) : null}
              <div className="mt-2 space-y-1">
                <p className="text-xs font-medium">Povolené přístupy:</p>
                <div className="flex flex-wrap gap-1">
                  {app.scopes.map((s) => (
                    <span key={s} className="rounded-full bg-muted px-2 py-0.5 text-xs">
                      {SCOPE_LABELS[s] ?? s}
                    </span>
                  ))}
                </div>
              </div>
              <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
                <span><Clock className="inline h-3 w-3" /> Připojeno {new Date(app.granted_at).toLocaleDateString('cs-CZ')}</span>
                {app.last_used_at ? (
                  <span>Naposledy {new Date(app.last_used_at).toLocaleDateString('cs-CZ')}</span>
                ) : null}
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => revoke(app.client_id, app.app_name)}
              className="text-rose-700 hover:bg-rose-50"
            >
              <Trash2 className="mr-1 h-3 w-3" /> Odvolat
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
