'use client';

import { FormEvent, useEffect, useState } from 'react';
import { PageHeader } from '@/components/admin/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

interface Domain {
  id: string;
  domain: string;
  verified_at: string | null;
  verification_token: string;
  primary_domain: boolean;
  created_at: string;
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

export default function DomainsPage() {
  const [domains, setDomains] = useState<Domain[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [domain, setDomain] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    const res = await authFetch('/api/admin/domains');
    if (res.ok) setDomains((((await res.json()) as { domains: Domain[] }).domains) ?? []);
  }

  async function add(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setFeedback(null);
    try {
      const res = await authFetch('/api/admin/domains', {
        method: 'POST',
        body: JSON.stringify({ domain: domain.toLowerCase() }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        error?: string;
        instructions?: string;
      };
      if (!res.ok) {
        setError(j.error ?? `HTTP ${res.status}`);
        return;
      }
      setFeedback(j.instructions ?? 'Doména přidána. Přidej DNS TXT record a klikni Verify.');
      setDomain('');
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function verify(id: string, force = false) {
    setError(null);
    setFeedback(null);
    const res = await authFetch(`/api/admin/domains/${id}/verify${force ? '?force=true' : ''}`, {
      method: 'POST',
    });
    const j = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
      message?: string;
      expectedRecord?: string;
      foundRecords?: string[];
    };
    if (!res.ok) {
      setError(
        `${j.error}: ${j.message ?? ''}${j.expectedRecord ? ` Expected: ${j.expectedRecord}` : ''}`,
      );
      return;
    }
    setFeedback('Doména ověřena.');
    await load();
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Vlastní domény"
        description="Pokud máš vlastní doménu (např. tickets.firma.cz), přidej ji a verifikuj přes DNS TXT record."
      />

      {error ? (
        <div className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">
          {error}
        </div>
      ) : null}
      {feedback ? (
        <div className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">
          {feedback}
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Přidat doménu</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={add} className="flex gap-2">
            <Input
              value={domain}
              onChange={(e) => setDomain(e.target.value.toLowerCase())}
              placeholder="tickets.example.cz"
              pattern="[a-z0-9.-]+\.[a-z]{2,}"
              required
              className="max-w-md"
            />
            <Button type="submit" disabled={busy}>
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
            <p className="text-sm text-muted-foreground">Žádné vlastní domény.</p>
          ) : (
            <div className="space-y-3">
              {domains.map((d) => (
                <div key={d.id} className="rounded-md border bg-card p-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-medium">{d.domain}</span>
                        {d.primary_domain ? (
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
                            primary
                          </span>
                        ) : null}
                        {d.verified_at ? (
                          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800">
                            ověřeno
                          </span>
                        ) : (
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
                            čeká na verifikaci
                          </span>
                        )}
                      </div>
                      {!d.verified_at ? (
                        <div className="mt-2 rounded-md bg-muted/30 p-2 font-mono text-[11px]">
                          <div>Přidej DNS TXT record:</div>
                          <div>
                            <strong>_tixly-verify.{d.domain}</strong>
                          </div>
                          <div>= "{d.verification_token}"</div>
                        </div>
                      ) : null}
                    </div>
                    <div className="flex flex-col gap-1">
                      {!d.verified_at ? (
                        <>
                          <Button size="sm" onClick={() => verify(d.id)}>
                            Verify
                          </Button>
                          <button
                            type="button"
                            onClick={() => verify(d.id, true)}
                            className="text-[10px] text-muted-foreground hover:underline"
                          >
                            (force — jen v dev)
                          </button>
                        </>
                      ) : null}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
