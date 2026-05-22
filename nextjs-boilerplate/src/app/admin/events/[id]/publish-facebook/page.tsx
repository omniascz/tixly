'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { PageHeader } from '@/components/admin/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

interface FbPage {
  id: string;
  fbPageId: string;
  name: string;
  isMock: boolean;
}

interface Publish {
  id: string;
  fbEventId: string;
  pageName: string;
  status: string;
  publishedAt: string;
  permalinkUrl: string;
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

export default function PublishFacebookPage(): JSX.Element {
  const params = useParams<{ id: string }>();
  const eventId = params.id;

  const [pages, setPages] = useState<FbPage[] | null>(null);
  const [publishes, setPublishes] = useState<Publish[]>([]);
  const [selectedPageId, setSelectedPageId] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ url: string; isMock: boolean } | null>(null);

  async function load(): Promise<void> {
    try {
      const [pagesRes, publishesRes] = await Promise.all([
        authFetch('/api/admin/facebook/pages'),
        authFetch(`/api/admin/events/${eventId}/publish-facebook`),
      ]);
      if (pagesRes.ok) {
        const d = (await pagesRes.json()) as { pages: FbPage[] };
        setPages(d.pages);
        if (d.pages.length > 0 && !selectedPageId) setSelectedPageId(d.pages[0].id);
      }
      if (publishesRes.ok) {
        const d = (await publishesRes.json()) as { publishes: Publish[] };
        setPublishes(d.publishes);
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }

  useEffect(() => {
    void load();
  }, [eventId]);

  async function publish(): Promise<void> {
    if (!selectedPageId) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await authFetch(`/api/admin/events/${eventId}/publish-facebook`, {
        method: 'POST',
        body: JSON.stringify({ pageId: selectedPageId }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        permalinkUrl?: string;
        alreadyPublished?: boolean;
        isMock?: boolean;
        error?: string;
        message?: string;
      };
      if (!res.ok || !j.ok) {
        setError(j.message ?? j.error ?? `HTTP ${res.status}`);
        return;
      }
      setResult({ url: j.permalinkUrl!, isMock: j.isMock ?? false });
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Publikovat na Facebook"
        description="1 klikem vytvoříš FB Event s ticket linkem zpět do Tixly. Idempotent — opakovaný klik vrátí stejný fb_event_id."
        actions={
          <Link href="/admin/facebook">
            <Button variant="outline" size="sm">
              ← FB nastavení
            </Button>
          </Link>
        }
      />

      {error ? (
        <div className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">
          {error}
        </div>
      ) : null}
      {result ? (
        <div className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">
          ✅ Publikováno! {result.isMock ? '(mock)' : ''}
          <br />
          <a
            href={result.url}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium underline"
            data-testid="fb-event-permalink"
          >
            {result.url}
          </a>
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Vybrat FB stránku</CardTitle>
          <CardDescription>
            Event bude publikován jako FB Event pod vybranou stránkou s ticket linkem.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!pages ? (
            <p className="text-sm text-muted-foreground">Načítání…</p>
          ) : pages.length === 0 ? (
            <div className="space-y-2">
              <p className="text-sm">
                Žádná napojená stránka. Nejdřív musíš napojit FB.
              </p>
              <Link href="/admin/facebook">
                <Button size="sm">→ Napojit FB stránku</Button>
              </Link>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="space-y-2">
                {pages.map((p) => (
                  <label
                    key={p.id}
                    className={`flex cursor-pointer items-center gap-3 rounded-md border p-3 text-sm ${
                      selectedPageId === p.id ? 'border-primary bg-primary/5' : ''
                    }`}
                  >
                    <input
                      type="radio"
                      name="fbPage"
                      value={p.id}
                      checked={selectedPageId === p.id}
                      onChange={() => setSelectedPageId(p.id)}
                      data-testid={`fb-page-select-${p.fbPageId}`}
                    />
                    <span className="font-medium">{p.name}</span>
                    {p.isMock ? (
                      <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-900">
                        mock
                      </span>
                    ) : null}
                  </label>
                ))}
              </div>
              <Button
                onClick={() => void publish()}
                disabled={busy || !selectedPageId}
                data-testid="fb-publish-button"
              >
                {busy ? 'Publikuji…' : '📘 Publikovat na Facebook'}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {publishes.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Historie publikací ({publishes.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2" data-testid="fb-publish-history">
              {publishes.map((p) => (
                <li
                  key={p.id}
                  className="flex items-center justify-between rounded-md border p-2 text-sm"
                >
                  <div>
                    <div className="font-medium">{p.pageName}</div>
                    <div className="text-xs text-muted-foreground">
                      {p.status} · {new Date(p.publishedAt).toLocaleString('cs-CZ')}
                      {p.isMock ? ' · mock' : ''}
                    </div>
                  </div>
                  <a
                    href={p.permalinkUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-blue-700 hover:underline"
                  >
                    Otevřít →
                  </a>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
