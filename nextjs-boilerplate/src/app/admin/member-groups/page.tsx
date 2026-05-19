'use client';

import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { PageHeader } from '@/components/admin/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

interface Group {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  member_count: number;
  rules_count: number;
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

export default function MemberGroupsPage() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const [slug, setSlug] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    const res = await authFetch('/api/admin/member-groups');
    if (res.ok) setGroups((((await res.json()) as { groups: Group[] }).groups) ?? []);
  }

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setFeedback(null);
    try {
      const res = await authFetch('/api/admin/member-groups', {
        method: 'POST',
        body: JSON.stringify({ slug, name, description: description || null }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(j.error ?? `HTTP ${res.status}`);
        return;
      }
      setFeedback('Skupina vytvořena.');
      setSlug('');
      setName('');
      setDescription('');
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Členské skupiny"
        description="Pro Barcelona socios, Met Members, museum members. Bulk import emailů + per-ticket-type pricing rules."
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
          <CardTitle>Nová skupina</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={create} className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs uppercase text-muted-foreground">Slug</label>
              <Input
                value={slug}
                onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                required
                placeholder="barcelona-socios"
                pattern="[a-z0-9-]+"
              />
            </div>
            <div className="md:col-span-2">
              <label className="mb-1 block text-xs uppercase text-muted-foreground">Název</label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                placeholder="FC Barcelona Socios"
              />
            </div>
            <div className="md:col-span-3">
              <label className="mb-1 block text-xs uppercase text-muted-foreground">Popis</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              />
            </div>
            <div className="md:col-span-3">
              <Button type="submit" disabled={busy || !slug || !name}>
                {busy ? 'Vytvářím…' : 'Vytvořit'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Skupiny ({groups.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {groups.length === 0 ? (
            <p className="text-sm text-muted-foreground">Zatím žádná.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                  <th className="py-2">Slug</th>
                  <th>Název</th>
                  <th className="text-right">Členů</th>
                  <th className="text-right">Pricing rules</th>
                  <th className="text-right">Akce</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => (
                  <tr key={g.id} className="border-b">
                    <td className="py-2 font-mono text-xs">{g.slug}</td>
                    <td className="font-medium">{g.name}</td>
                    <td className="text-right tabular-nums">{g.member_count}</td>
                    <td className="text-right tabular-nums">{g.rules_count}</td>
                    <td className="text-right">
                      <Link
                        href={`/admin/member-groups/${g.id}`}
                        className="text-xs text-primary hover:underline"
                      >
                        Spravovat →
                      </Link>
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
