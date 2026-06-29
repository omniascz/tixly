'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

interface SavedMethod {
  id: string;
  card_mask: string | null;
  card_brand: string | null;
  expires_month: number | null;
  expires_year: number | null;
  is_default: boolean;
  created_at: string;
}

function authFetch(url: string, init?: RequestInit): Promise<Response> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
  return fetch(url, {
    ...init,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
}

export default function MyPaymentMethodsPage() {
  const [methods, setMethods] = useState<SavedMethod[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    try {
      const res = await authFetch('/api/buyer/saved-payment-methods');
      if (!res.ok) {
        setError(res.status === 401 ? 'Pro zobrazení platebních metod se musíš přihlásit.' : `HTTP ${res.status}`);
        return;
      }
      const d = (await res.json()) as { methods: SavedMethod[] };
      setMethods(d.methods ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Síťová chyba');
    }
  }

  useEffect(() => { void load(); }, []);

  async function deleteMethod(id: string) {
    if (!confirm('Smazat uloženou kartu?')) return;
    setBusy(id);
    try {
      const res = await authFetch(`/api/buyer/saved-payment-methods/${id}`, { method: 'DELETE' });
      if (res.ok) await load();
      else setError(`Smazání selhalo: HTTP ${res.status}`);
    } finally {
      setBusy(null);
    }
  }

  async function setDefault(id: string) {
    setBusy(id);
    try {
      const res = await authFetch(`/api/buyer/saved-payment-methods/${id}`, { method: 'PATCH' });
      if (res.ok) await load();
      else setError(`Nepodařilo se nastavit výchozí: HTTP ${res.status}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold">Platební metody</h1>

      {error ? (
        <div className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">
          {error}
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Uložené karty</CardTitle>
          <CardDescription>
            Uložené platební metody jsou šifrovaně uloženy a slouží pro rychlý checkout.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {methods === null ? (
            <p className="text-sm text-muted-foreground">Načítám…</p>
          ) : methods.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Zatím nemáš žádné uložené platební metody. Po platbě kartou budeš mít možnost kartu uložit pro příští nákupy.
            </p>
          ) : (
            <div className="space-y-3">
              {methods.map(m => (
                <div
                  key={m.id}
                  className={`flex items-center justify-between rounded-md border p-3 ${m.is_default ? 'border-primary bg-primary/5' : ''}`}
                >
                  <div>
                    <p className="text-sm font-medium">
                      {m.card_brand ?? 'Karta'} {m.card_mask ?? ''}
                      {m.is_default ? (
                        <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">výchozí</span>
                      ) : null}
                    </p>
                    {m.expires_month && m.expires_year ? (
                      <p className="text-xs text-muted-foreground">
                        Platí do: {m.expires_month}/{m.expires_year}
                      </p>
                    ) : null}
                    <p className="text-xs text-muted-foreground">
                      Přidáno: {new Date(m.created_at).toLocaleDateString('cs-CZ')}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {!m.is_default ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void setDefault(m.id)}
                        disabled={busy === m.id}
                      >
                        Nastavit výchozí
                      </Button>
                    ) : null}
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-rose-200 text-rose-700 hover:bg-rose-50"
                      onClick={() => void deleteMethod(m.id)}
                      disabled={busy === m.id}
                    >
                      {busy === m.id ? '…' : 'Smazat'}
                    </Button>
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
