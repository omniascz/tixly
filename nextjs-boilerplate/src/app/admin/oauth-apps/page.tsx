'use client';

import { useEffect, useState, type JSX } from 'react';
import { Key, Plus, Copy } from 'lucide-react';
import { PageHeader } from '@/components/admin/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { typedGet, typedPost, TypedFetchError } from '@/lib/typed-fetch';

interface OAuthApp {
  id: string; client_id: string;
  app_name: string; app_description: string | null;
  app_logo_url: string | null;
  redirect_uris: string[]; allowed_scopes: string[];
  status: string; rate_limit_per_hour: number;
  created_at: string;
}

const SCOPES = ['read_events', 'write_events', 'read_orders', 'write_orders',
  'read_attendees', 'read_tickets', 'manage_webhooks'];

export default function OAuthAppsPage(): JSX.Element {
  const [apps, setApps] = useState<OAuthApp[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [credentials, setCredentials] = useState<{ clientId: string; clientSecret: string } | null>(null);

  const [appName, setAppName] = useState('');
  const [appDescription, setAppDescription] = useState('');
  const [redirectUri, setRedirectUri] = useState('');
  const [selectedScopes, setSelectedScopes] = useState<string[]>(['read_events', 'read_orders']);

  useEffect(() => { void load(); }, []);

  async function load(): Promise<void> {
    try {
      const r = await typedGet<{ apps: OAuthApp[] }>('/api/admin/oauth-apps');
      setApps(r.apps ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Chyba');
    }
  }

  async function create(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const r = await typedPost<{
        clientId: string; clientSecret: string; warning?: string;
      }>('/api/admin/oauth-apps', {
        appName,
        appDescription: appDescription || undefined,
        redirectUris: [redirectUri],
        allowedScopes: selectedScopes,
      }, { throwOnError: true });
      setCredentials({ clientId: r.clientId, clientSecret: r.clientSecret });
      setAppName(''); setAppDescription(''); setRedirectUri('');
      await load();
    } catch (err) {
      if (err instanceof TypedFetchError) {
        setError((err.body as { error?: string })?.error ?? `HTTP ${err.status}`);
      } else {
        setError(err instanceof Error ? err.message : 'Chyba');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="OAuth Apps (3rd party integrace)"
        description="Registruj svou aplikaci pro OAuth 2.0 access do Tixly API."
      />

      {error ? <div className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">{error}</div> : null}

      {credentials ? (
        <Card className="border-emerald-400 bg-emerald-50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-emerald-900">
              ✅ App vytvořena
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-emerald-900">
              <strong>⚠️ Client secret se zobrazuje JEN teď.</strong> Ulož ho — později ho nelze získat zpět.
            </p>
            <div>
              <label className="text-xs">Client ID</label>
              <div className="flex gap-2">
                <Input value={credentials.clientId} readOnly className="font-mono text-xs" />
                <button type="button" onClick={() => navigator.clipboard.writeText(credentials.clientId)}>
                  <Copy className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div>
              <label className="text-xs">Client Secret</label>
              <div className="flex gap-2">
                <Input value={credentials.clientSecret} readOnly className="font-mono text-xs" />
                <button type="button" onClick={() => navigator.clipboard.writeText(credentials.clientSecret)}>
                  <Copy className="h-4 w-4" />
                </button>
              </div>
            </div>
            <Button variant="outline" onClick={() => { setCredentials(null); setShowForm(false); }}>
              Zavřít
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <div className="flex justify-between">
        <p className="text-sm text-muted-foreground">{apps.length} apps</p>
        <Button onClick={() => setShowForm(!showForm)}>{showForm ? 'Zavřít' : '+ Nová app'}</Button>
      </div>

      {showForm && !credentials ? (
        <Card>
          <CardHeader><CardTitle>Registrace OAuth app</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium">Název app</label>
              <Input value={appName} onChange={(e) => setAppName(e.target.value)}
                placeholder="např. My Festival App" maxLength={200} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Popis</label>
              <Input value={appDescription} onChange={(e) => setAppDescription(e.target.value)} maxLength={2000} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Redirect URI *</label>
              <Input type="url" value={redirectUri} onChange={(e) => setRedirectUri(e.target.value)}
                placeholder="https://myapp.cz/oauth/callback" />
            </div>
            <div>
              <label className="mb-2 block text-xs font-medium">Povolené scopes</label>
              <div className="grid grid-cols-2 gap-1">
                {SCOPES.map((s) => (
                  <label key={s} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={selectedScopes.includes(s)}
                      onChange={(e) => setSelectedScopes(e.target.checked
                        ? [...selectedScopes, s]
                        : selectedScopes.filter((x) => x !== s))} />
                    <code className="text-xs">{s}</code>
                  </label>
                ))}
              </div>
            </div>
            <Button onClick={create} disabled={busy || !appName || !redirectUri}>
              <Plus className="mr-1 h-4 w-4" /> {busy ? 'Vytvářím…' : 'Vytvořit app'}
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {apps.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 p-8 text-center">
            <Key className="h-10 w-10 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Žádné OAuth apps. Pro 3rd party integraci (např. mobilní app, partner site) registruj client.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {apps.map((a) => (
            <Card key={a.id}>
              <CardContent className="pt-4">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-semibold">{a.app_name}</p>
                    {a.app_description ? <p className="text-sm text-muted-foreground">{a.app_description}</p> : null}
                    <p className="mt-1 font-mono text-xs text-muted-foreground">{a.client_id}</p>
                  </div>
                  <span className={`rounded-full px-2 py-1 text-xs ${
                    a.status === 'active' ? 'bg-emerald-100 text-emerald-800' :
                    a.status === 'suspended' ? 'bg-amber-100 text-amber-800' : 'bg-rose-100'
                  }`}>{a.status}</span>
                </div>
                <div className="mt-2 text-xs text-muted-foreground">
                  Scopes: {a.allowed_scopes.join(', ')}
                  {' · '}
                  Rate limit: {a.rate_limit_per_hour}/h
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
