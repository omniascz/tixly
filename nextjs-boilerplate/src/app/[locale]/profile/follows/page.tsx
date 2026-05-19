'use client';

import { useEffect, useState } from 'react';
import { Bell, BellOff } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

interface Follow {
  subscriptionId: string;
  promoterId: string;
  promoterName: string;
  promoterSlug: string;
  brandColorHex: string | null;
  status: string;
  confirmedAt: string | null;
  upcomingCount: number;
}

function authFetch(url: string, init?: RequestInit): Promise<Response> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
  return fetch(url, {
    ...init,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
}

export default function MyFollowsPage({ params }: { params: { locale: string } }) {
  const [follows, setFollows] = useState<Follow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    setBusy(true);
    setError(null);
    try {
      const res = await authFetch('/api/buyer/follows');
      if (!res.ok) {
        if (res.status === 401) setError('Pro zobrazení sledování se musíš přihlásit.');
        else setError(`HTTP ${res.status}`);
        return;
      }
      const data = (await res.json()) as { follows: Follow[] };
      setFollows(data.follows ?? []);
    } finally {
      setBusy(false);
    }
  }

  async function unfollow(f: Follow) {
    if (!confirm(`Přestat sledovat „${f.promoterName}"?`)) return;
    setBusy(true);
    try {
      await authFetch(`/api/buyer/follows?promoterId=${f.promoterId}`, { method: 'DELETE' });
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 py-6">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-bold">Sledovaní pořadatelé</h1>
        <Link
          href={`/${params.locale}/profile`}
          className="text-sm text-primary hover:underline"
        >
          ← Zpět na profil
        </Link>
      </div>

      {error ? (
        <div className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">
          {error}
        </div>
      ) : null}

      {!error && follows.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center">
            <Bell className="mx-auto mb-3 h-10 w-10 text-muted-foreground" aria-hidden />
            <p className="text-sm text-muted-foreground">
              {busy ? 'Načítám…' : 'Zatím nesleduješ žádné pořadatele.'}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              Na detailu pořadatele (např.{' '}
              <Link
                href={`/${params.locale}/p/divadlo-verze`}
                className="text-primary hover:underline"
              >
                Divadlo Verze
              </Link>
              ) klikni „Sledovat" a budeš dostávat newsletter s novinkami.
            </p>
          </CardContent>
        </Card>
      ) : null}

      <div className="space-y-2">
        {follows.map((f) => (
          <Card key={f.subscriptionId}>
            <CardHeader className="flex flex-row items-start justify-between gap-3 pb-3">
              <div className="flex items-start gap-3">
                <div
                  aria-hidden
                  className="h-12 w-12 shrink-0 rounded-md"
                  style={{
                    background: f.brandColorHex && /^#[0-9a-f]{6}$/i.test(f.brandColorHex)
                      ? f.brandColorHex
                      : '#94a3b8',
                  }}
                />
                <div>
                  <CardTitle className="text-base">
                    <Link
                      href={`/${params.locale}/p/${f.promoterSlug}`}
                      className="hover:underline"
                    >
                      {f.promoterName}
                    </Link>
                  </CardTitle>
                  <CardDescription>
                    {f.upcomingCount > 0
                      ? `${f.upcomingCount} nadcházejících akcí`
                      : 'Žádné nadcházející akce'}
                    {f.status === 'pending' ? ' · ověření čeká (zkontroluj e-mail)' : ''}
                  </CardDescription>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void unfollow(f)}
                disabled={busy}
                className="border-rose-300 text-rose-700 hover:bg-rose-50"
              >
                <BellOff className="mr-1 h-4 w-4" aria-hidden />
                Přestat sledovat
              </Button>
            </CardHeader>
          </Card>
        ))}
      </div>
    </div>
  );
}
