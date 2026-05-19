'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface Verification {
  id: string;
  type: string;
  status: string;
  proof_url: string;
  created_at: string;
  user_email: string;
  user_name: string | null;
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

export default function PlatformVerificationsPage() {
  const [verifications, setVerifications] = useState<Verification[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    try {
      const res = await authFetch('/api/platform/verifications?status=pending');
      if (!res.ok) {
        setError(`HTTP ${res.status}`);
        return;
      }
      setVerifications((((await res.json()) as { verifications: Verification[] }).verifications) ?? []);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function decide(id: string, decision: 'approve' | 'reject') {
    setBusy(id);
    setError(null);
    try {
      let body: Record<string, unknown> = { decision };
      if (decision === 'reject') {
        const reason = prompt('Důvod zamítnutí:');
        if (!reason || reason.length < 2) {
          setBusy(null);
          return;
        }
        body = { decision, rejectionReason: reason };
      } else {
        // Default expirace 1 rok
        const expiresAt = new Date();
        expiresAt.setFullYear(expiresAt.getFullYear() + 1);
        body = { decision, expiresAt: expiresAt.toISOString() };
      }
      const res = await authFetch(`/api/platform/verifications/${id}`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setError(j.error ?? `HTTP ${res.status}`);
        return;
      }
      setFeedback(`Žádost ${decision === 'approve' ? 'schválena' : 'zamítnuta'}.`);
      await load();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Verification queue</h1>
        <p className="text-sm text-muted-foreground">
          Pending žádosti o student/senior/disability slevy. Kontrol a schvál nebo zamítni.
        </p>
      </div>

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
          <CardTitle>Pending ({verifications.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {verifications.length === 0 ? (
            <p className="text-sm text-muted-foreground">Žádné pending žádosti.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                  <th className="py-2">Žadatel</th>
                  <th>Typ</th>
                  <th>Proof</th>
                  <th>Žádost</th>
                  <th className="text-right">Akce</th>
                </tr>
              </thead>
              <tbody>
                {verifications.map((v) => (
                  <tr key={v.id} className="border-b">
                    <td className="py-2">
                      <div className="font-medium">{v.user_name ?? '—'}</div>
                      <div className="text-xs text-muted-foreground">{v.user_email}</div>
                    </td>
                    <td className="text-xs">{v.type}</td>
                    <td>
                      <a
                        href={v.proof_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-primary hover:underline"
                      >
                        Otevřít →
                      </a>
                    </td>
                    <td className="text-xs text-muted-foreground">
                      {new Date(v.created_at).toLocaleDateString('cs-CZ')}
                    </td>
                    <td className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => decide(v.id, 'approve')}
                          disabled={busy === v.id}
                        >
                          Schválit
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => decide(v.id, 'reject')}
                          disabled={busy === v.id}
                        >
                          Zamítnout
                        </Button>
                      </div>
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
