'use client';

import { FormEvent, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

interface Verification {
  id: string;
  type: string;
  status: string;
  verified_at: string | null;
  expires_at: string | null;
  rejection_reason: string | null;
  created_at: string;
}

const TYPE_LABELS: Record<string, string> = {
  student: 'Student (ISIC)',
  senior: 'Senior',
  disability: 'ZTP/P',
  youth: 'Mládež do 26',
  press: 'Press / novinář',
  industry: 'Industry / B2B',
};

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

export function VerificationsClient({ locale: _locale }: { locale: string }) {
  const [verifications, setVerifications] = useState<Verification[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const [type, setType] = useState<string>('student');
  const [proofUrl, setProofUrl] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    try {
      const res = await authFetch('/api/buyer/verifications');
      if (res.status === 401) {
        setError('Pro správu oprávnění se musíš přihlásit.');
        return;
      }
      if (!res.ok) {
        setError(`HTTP ${res.status}`);
        return;
      }
      setVerifications((((await res.json()) as { verifications: Verification[] }).verifications) ?? []);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setFeedback(null);
    try {
      const res = await authFetch('/api/buyer/verifications', {
        method: 'POST',
        body: JSON.stringify({ type, proofUrl }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string; status?: string };
      if (!res.ok) {
        setError(j.error ?? `HTTP ${res.status}`);
        return;
      }
      setFeedback('Žádost odeslána, čeká na ověření.');
      setProofUrl('');
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
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
          <CardTitle>Nová žádost o slevu</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-3">
            <div>
              <label className="mb-1 block text-xs uppercase text-muted-foreground">Typ</label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value)}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              >
                {Object.entries(TYPE_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs uppercase text-muted-foreground">
                URL na proof (ISIC scan, senior pass photo, ZTP průkaz)
              </label>
              <Input
                type="url"
                value={proofUrl}
                onChange={(e) => setProofUrl(e.target.value)}
                required
                placeholder="https://imgur.com/your-isic-photo.jpg"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                V produkci by tu byl direct upload. Pro demo: nahraj na imgur/Drive a vlož link.
              </p>
            </div>
            <Button type="submit" disabled={busy || !proofUrl}>
              {busy ? 'Odesílám…' : 'Odeslat ke schválení'}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Historie</CardTitle>
        </CardHeader>
        <CardContent>
          {!verifications ? (
            <p className="text-sm text-muted-foreground">Načítání…</p>
          ) : verifications.length === 0 ? (
            <p className="text-sm text-muted-foreground">Zatím žádné.</p>
          ) : (
            <ul className="divide-y">
              {verifications.map((v) => (
                <li key={v.id} className="py-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{TYPE_LABELS[v.type] ?? v.type}</span>
                    <StatusBadge status={v.status} />
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Žádost {new Date(v.created_at).toLocaleDateString('cs-CZ')}
                    {v.verified_at
                      ? ` · ověřeno ${new Date(v.verified_at).toLocaleDateString('cs-CZ')}`
                      : ''}
                    {v.expires_at
                      ? ` · platí do ${new Date(v.expires_at).toLocaleDateString('cs-CZ')}`
                      : ''}
                  </div>
                  {v.rejection_reason ? (
                    <div className="mt-1 text-xs text-rose-700">
                      Důvod zamítnutí: {v.rejection_reason}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    pending: 'bg-amber-100 text-amber-800',
    verified: 'bg-emerald-100 text-emerald-800',
    rejected: 'bg-rose-100 text-rose-800',
    expired: 'bg-slate-100 text-slate-700',
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${map[status] ?? 'bg-muted'}`}>
      {status}
    </span>
  );
}
