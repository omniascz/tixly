'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { PageHeader } from '@/components/admin/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

interface FbPage {
  id: string;
  fbPageId: string;
  name: string;
  category: string | null;
  pictureUrl: string | null;
  connectedAt: string;
  isMock: boolean;
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

export default function FacebookSettingsPage(): JSX.Element {
  const searchParams = useSearchParams();
  const [pages, setPages] = useState<FbPage[] | null>(null);
  const [mockMode, setMockMode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const connected = searchParams.get('connected');
  const queryError = searchParams.get('error');
  const justMock = searchParams.get('mock') === '1';

  async function load(): Promise<void> {
    try {
      const res = await authFetch('/api/admin/facebook/pages');
      if (!res.ok) {
        setError(`HTTP ${res.status}`);
        return;
      }
      const data = (await res.json()) as { mockMode: boolean; pages: FbPage[] };
      setPages(data.pages);
      setMockMode(data.mockMode);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function connectFb(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const res = await authFetch('/api/admin/facebook/oauth/start');
      if (!res.ok) {
        setError(`HTTP ${res.status}`);
        return;
      }
      const data = (await res.json()) as { redirectUrl: string; isMock: boolean };
      // Mock mód: rovnou jdeme na callback (s code+state); real mód: FB OAuth dialog.
      window.location.href = data.redirectUrl;
    } finally {
      setBusy(false);
    }
  }

  async function disconnect(pageId: string): Promise<void> {
    if (!confirm('Odpojit tuto FB stránku?')) return;
    setBusy(true);
    try {
      const res = await authFetch(`/api/admin/facebook/pages/${pageId}/disconnect`, {
        method: 'POST',
      });
      if (!res.ok) {
        setError(`HTTP ${res.status}`);
        return;
      }
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Facebook integrace"
        description="Napoj svou FB stránku a publikuj events 1 klikem. Po napojení uvidíš tlačítko 'Publikovat na Facebook' v detailu každé akce."
      />

      {mockMode ? (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <strong>🧪 Demo režim:</strong> FACEBOOK_APP_ID není nastavený. OAuth a publish jsou
          mockované, fake fb_page_id + fb_event_id. Pro produkci přidej Meta App credentials
          do .env.local.
        </div>
      ) : null}

      {queryError ? (
        <div className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">
          OAuth selhal: {queryError}
        </div>
      ) : null}
      {connected ? (
        <div className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">
          Napojeno {connected} {Number(connected) === 1 ? 'stránka' : 'stránek'}
          {justMock ? ' (mock)' : ''}.
        </div>
      ) : null}
      {error ? (
        <div className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">
          {error}
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Napojit Facebook stránku</CardTitle>
          <CardDescription>
            Klik na tlačítko spustí Facebook OAuth. Po autorizaci se uloží long-lived page
            token (~60 dní). Po vypršení stačí re-OAuth.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={() => void connectFb()} disabled={busy} data-testid="fb-connect">
            {busy ? 'Otevírám…' : '🔗 Napojit Facebook stránku'}
          </Button>
          <p className="mt-2 text-xs text-muted-foreground">
            Vyžadované oprávnění: <code>pages_show_list</code>, <code>pages_manage_posts</code>,{' '}
            <code>pages_manage_events</code>.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Napojené stránky ({pages?.length ?? 0})</CardTitle>
        </CardHeader>
        <CardContent>
          {!pages ? (
            <p className="text-sm text-muted-foreground">Načítání…</p>
          ) : pages.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Zatím žádná napojená stránka. Klikni nahoře na „Napojit Facebook stránku".
            </p>
          ) : (
            <ul className="space-y-2" data-testid="fb-pages-list">
              {pages.map((p) => (
                <li
                  key={p.id}
                  className="flex items-center justify-between rounded-md border p-3"
                >
                  <div className="flex items-center gap-3">
                    {p.pictureUrl ? (
                      <img
                        src={p.pictureUrl}
                        alt={p.name}
                        className="h-10 w-10 rounded-full"
                      />
                    ) : (
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-100 text-lg">
                        📘
                      </div>
                    )}
                    <div>
                      <div className="font-medium">
                        {p.name}
                        {p.isMock ? (
                          <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-900">
                            mock
                          </span>
                        ) : null}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {p.category ?? '—'} · ID {p.fbPageId.slice(0, 12)}…
                      </div>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void disconnect(p.id)}
                    disabled={busy}
                    data-testid={`fb-disconnect-${p.fbPageId}`}
                  >
                    Odpojit
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
