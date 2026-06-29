'use client';

import { FormEvent, useEffect, useState } from 'react';
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

interface Partner {
  id: string;
  name: string;
  client_id: string;
  scopes: string[];
  active: boolean;
  last_used_at: string | null;
  created_at: string;
}

export default function DistributionPartnersPage() {
  const [partners, setPartners] = useState<Partner[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [newPartnerSecret, setNewPartnerSecret] = useState<{ client_id: string; client_secret: string; name: string } | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    const res = await authFetch('/api/platform/distribution-partners');
    if (res.ok) {
      const j = (await res.json()) as { partners: Partner[] };
      setPartners(j.partners);
    }
  }

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await authFetch('/api/platform/distribution-partners', {
        method: 'POST',
        body: JSON.stringify({ name }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        client_id?: string;
        client_secret?: string;
        error?: string;
      };
      if (!res.ok) {
        setError(j.error ?? `HTTP ${res.status}`);
        return;
      }
      setNewPartnerSecret({ client_id: j.client_id!, client_secret: j.client_secret!, name });
      setName('');
      void load();
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(id: string, active: boolean) {
    setBusyId(id);
    try {
      await authFetch(`/api/platform/distribution-partners/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ active }),
      });
      void load();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold">B2B Distribuční partneři</h1>
        <p className="text-sm text-muted-foreground mt-1">OAuth2 client_credentials přístup k event feedu.</p>
      </div>

      {error ? (
        <div className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">{error}</div>
      ) : null}

      {newPartnerSecret ? (
        <div className="rounded-md border border-emerald-400 bg-emerald-50 p-4">
          <p className="font-bold text-emerald-900">Partner vytvořen — client_secret se zobrazí jen jednou!</p>
          <div className="mt-2 font-mono text-sm space-y-1">
            <div><span className="text-muted-foreground">client_id: </span>{newPartnerSecret.client_id}</div>
            <div><span className="text-muted-foreground">client_secret: </span>{newPartnerSecret.client_secret}</div>
          </div>
          <Button size="sm" variant="outline" className="mt-3" onClick={() => setNewPartnerSecret(null)}>
            Zavřít
          </Button>
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Přidat partnera</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={create} className="flex gap-2">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Název partnera (např. Ticketmaster CZ)"
              required
              className="max-w-sm"
            />
            <Button type="submit" disabled={busy || !name.trim()}>
              {busy ? 'Vytvářím…' : 'Vytvořit'}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Partneři ({partners.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {partners.length === 0 ? (
            <p className="text-sm text-muted-foreground">Žádní partneři.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                  <th className="py-2">Název</th>
                  <th>Client ID</th>
                  <th>Scopes</th>
                  <th>Poslední použití</th>
                  <th>Stav</th>
                  <th>Akce</th>
                </tr>
              </thead>
              <tbody>
                {partners.map((p) => (
                  <tr key={p.id} className="border-b">
                    <td className="py-2 font-medium">{p.name}</td>
                    <td className="font-mono text-xs">{p.client_id}</td>
                    <td className="text-xs">{p.scopes.join(', ')}</td>
                    <td className="text-xs text-muted-foreground">
                      {p.last_used_at ? new Date(p.last_used_at).toLocaleString('cs-CZ') : '—'}
                    </td>
                    <td>
                      {p.active ? (
                        <Badge variant="outline" className="text-emerald-700 border-emerald-400">Aktivní</Badge>
                      ) : (
                        <Badge variant="outline" className="text-rose-700 border-rose-400">Neaktivní</Badge>
                      )}
                    </td>
                    <td>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busyId === p.id}
                        onClick={() => toggleActive(p.id, !p.active)}
                      >
                        {p.active ? 'Deaktivovat' : 'Aktivovat'}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
