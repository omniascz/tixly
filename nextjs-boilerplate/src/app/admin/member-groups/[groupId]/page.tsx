'use client';

import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { PageHeader } from '@/components/admin/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface Member {
  id: string;
  email: string;
  member_number: string | null;
  valid_from: string | null;
  valid_until: string | null;
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

export default function MemberGroupDetailPage() {
  const params = useParams();
  const groupId = String(params.groupId);

  const [members, setMembers] = useState<Member[]>([]);
  const [bulkInput, setBulkInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    const res = await authFetch(`/api/admin/member-groups/${groupId}/users`);
    if (res.ok) setMembers((((await res.json()) as { members: Member[] }).members) ?? []);
  }

  async function bulkImport(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setFeedback(null);
    try {
      // Format: jeden email per řádek nebo "email,memberNumber"
      const lines = bulkInput
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);
      const members = lines.map((line) => {
        const [email, memberNumber] = line.split(',').map((s) => s.trim());
        return { email, memberNumber: memberNumber || undefined };
      });
      const valid = members.filter((m) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(m.email));
      if (valid.length === 0) {
        setError('Žádný validní e-mail v inputu.');
        return;
      }
      const res = await authFetch(`/api/admin/member-groups/${groupId}/users`, {
        method: 'POST',
        body: JSON.stringify({ members: valid }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        inserted?: number;
        updated?: number;
        error?: string;
      };
      if (!res.ok) {
        setError(j.error ?? `HTTP ${res.status}`);
        return;
      }
      setFeedback(`Importováno: ${j.inserted} nových, ${j.updated} aktualizováno.`);
      setBulkInput('');
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Detail skupiny"
        description="Bulk import členů přes e-mail seznam."
        actions={
          <Link href="/admin/member-groups">
            <Button variant="outline" size="sm">
              ← Zpět
            </Button>
          </Link>
        }
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
          <CardTitle>Bulk import</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={bulkImport} className="space-y-3">
            <textarea
              value={bulkInput}
              onChange={(e) => setBulkInput(e.target.value)}
              rows={8}
              className="w-full rounded-md border bg-background px-3 py-2 font-mono text-xs"
              placeholder="email1@example.com&#10;email2@example.com,SOC123&#10;email3@example.com,SOC124"
            />
            <p className="text-xs text-muted-foreground">
              Formát: jeden e-mail per řádek, volitelně <code>email,memberNumber</code>. Max 1000 per
              import.
            </p>
            <Button type="submit" disabled={busy || !bulkInput.trim()}>
              {busy ? 'Importuji…' : 'Importovat'}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Členové ({members.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {members.length === 0 ? (
            <p className="text-sm text-muted-foreground">Žádní členové.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                  <th className="py-2">E-mail</th>
                  <th>Member #</th>
                  <th>Platí od</th>
                  <th>Platí do</th>
                </tr>
              </thead>
              <tbody>
                {members.slice(0, 200).map((m) => (
                  <tr key={m.id} className="border-b">
                    <td className="py-2">{m.email}</td>
                    <td className="text-xs">{m.member_number ?? '—'}</td>
                    <td className="text-xs text-muted-foreground">{m.valid_from ?? '—'}</td>
                    <td className="text-xs text-muted-foreground">{m.valid_until ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {members.length > 200 ? (
            <p className="mt-2 text-xs text-muted-foreground">
              Zobrazujem prvních 200 z {members.length}.
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
