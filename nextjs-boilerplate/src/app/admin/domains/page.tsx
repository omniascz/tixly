'use client';

import { FormEvent, useEffect, useState } from 'react';
import { PageHeader } from '@/components/admin/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';

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

interface Domain {
  id: string;
  domain: string;
  verified_at: string | null;
  verification_token: string;
  primary_domain: boolean;
  created_at: string;
}

export default function DomainsPage() {
  const [domains, setDomains] = useState<Domain[]>([]);
  const [newDomain, setNewDomain] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [verifyingId, setVerifyingId] = useState<string | null>(null);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    const res = await authFetch('/api/admin/domains');
    if (res.ok) {
      const j = (await res.json()) as { domains: Domain[] };
      setDomains(j.domains);
    }
  }

  async function addDomain(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setFeedback(null);
    try {
      const res = await authFetch('/api/admin/domains', {
        method: 'POST',
        body: JSON.stringify({ domain: newDomain.trim().toLowerCase() }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        id?: string;
        domain?: string;
        verificationToken?: string;
        instructions?: string;
        error?: string;
        issues?: unknown[];
      };
      if (!res.ok) {
        setError(j.error ?? `HTTP ${res.status}`);
        return;
      }
      setFeedback(j.instructions ?? 'Doména přidána. Přidej TXT record do DNS a klikni Ověřit.');
      setNewDomain('');
      void load();
    } finally {
      setBusy(false);
    }
  }

  async function verify(id: string) {
    setVerifyingId(id);
    setError(null);
    setFeedback(null);
    try {
      const res = await authFetch(`/api/admin/domains/${id}/verify`, { method: 'POST' });
      const j = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        message?: string;
        expectedRecord?: string;
      };
      if (!res.ok) {
        const msg = j.message ?? j.error ?? `HTTP ${res.status}`;
        setError(j.expectedRecord ? `${msg} — očekávaný záznam: ${j.expectedRecord}` : msg);
        return;
      }
      setFeedback('Doména úspěšně ověřena!');
      void load();
    } finally {
      setVerifyingId(null);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="White-label domény"
        description="Spravuj vlastní domény pro Tixly checkout a minisite."
      />

      {error ? (
        <div className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">{error}</div>
      ) : null}
      {feedback ? (
        <div className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900 whitespace-pre-wrap">{feedback}</div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Přidat doménu</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={addDomain} className="flex gap-2">
            <Input
              value={newDomain}
              onChange={(e) => setNewDomain(e.target.value)}
              placeholder="vstupenky.mojefirma.cz"
              required
              pattern="[a-z0-9.-]+\.[a-z]{2,}"
              className="max-w-sm"
            />
            <Button type="submit" disabled={busy || !newDomain.trim()}>
              {busy ? 'Přidávám…' : 'Přidat'}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Domény ({domains.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {domains.length === 0 ? (
            <p className="text-sm text-muted-foreground">Zatím žádné domény.</p>
          ) : (
            <div className="divide-y">
              {domains.map((d) => (
                <div key={d.id} className="py-4">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{d.domain}</span>
                        {d.primary_domain ? (
                          <Badge variant="default">Primární</Badge>
                        ) : null}
                        {d.verified_at ? (
                          <Badge variant="outline" className="text-emerald-700 border-emerald-400">Ověřeno</Badge>
                        ) : (
                          <Badge variant="outline" className="text-amber-700 border-amber-400">Čeká na ověření</Badge>
                        )}
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        Přidáno {new Date(d.created_at).toLocaleDateString('cs-CZ')}
                        {d.verified_at ? ` · Ověřeno ${new Date(d.verified_at).toLocaleDateString('cs-CZ')}` : ''}
                      </p>
                    </div>
                    {!d.verified_at ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => verify(d.id)}
                        disabled={verifyingId === d.id}
                      >
                        {verifyingId === d.id ? 'Ověřuji…' : 'Ověřit'}
                      </Button>
                    ) : null}
                  </div>
                  {!d.verified_at ? (
                    <div className="mt-3 rounded-md bg-muted p-3 text-xs font-mono">
                      <p className="mb-1 font-sans text-xs font-medium text-muted-foreground">Přidej do DNS:</p>
                      <p>TXT &nbsp;_tixly-verify.{d.domain}</p>
                      <p className="break-all">&nbsp;&nbsp;&nbsp;&nbsp;&quot;{d.verification_token}&quot;</p>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
