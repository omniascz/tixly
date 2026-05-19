'use client';

import { FormEvent, useState } from 'react';
import { PageHeader } from '@/components/admin/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

interface Result {
  tags: string[];
  byCategory: { genre: string[]; audience: string[]; vibe: string[] };
  provider: 'openai' | 'stub';
}

const CATEGORIES = ['concert', 'festival', 'theatre', 'club_party', 'sports', 'conference', 'other'];

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

export default function AutoTagToolPage() {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('concert');
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await authFetch('/api/admin/ai/auto-tag', {
        method: 'POST',
        body: JSON.stringify({
          title,
          description: description || null,
          category,
        }),
      });
      const j = (await res.json().catch(() => ({}))) as Result | { error?: string };
      if (!res.ok) {
        setError((j as { error?: string }).error ?? `HTTP ${res.status}`);
        return;
      }
      setResult(j as Result);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="🏷 AI auto-tagging"
        description="Z titulu + popisu vyextrahuje genre / audience / vibe tagy. Použij pro lepší search + recommendations."
      />

      {error ? (
        <div className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">
          {error}
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Extract tags</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={generate} className="space-y-3">
            <div>
              <label className="mb-1 block text-xs uppercase text-muted-foreground">Název</label>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                minLength={2}
                maxLength={200}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs uppercase text-muted-foreground">Kategorie</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full max-w-xs rounded-md border bg-background px-3 py-2 text-sm"
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs uppercase text-muted-foreground">Popis</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
                maxLength={5000}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              />
            </div>
            <Button type="submit" disabled={busy || title.length < 2}>
              {busy ? 'Extrahuji…' : '🏷 Extract tags'}
            </Button>
          </form>
        </CardContent>
      </Card>

      {result ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>Extracted tags ({result.tags.length})</span>
              <code className="rounded bg-muted px-2 py-0.5 text-xs">{result.provider}</code>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <TagGroup label="🎵 Genre" tags={result.byCategory.genre} color="blue" />
            <TagGroup label="👥 Audience" tags={result.byCategory.audience} color="emerald" />
            <TagGroup label="✨ Vibe" tags={result.byCategory.vibe} color="purple" />

            {result.tags.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Žádné tagy nebyly identifikovány. Přidej více kontextu do popisu nebo zkontroluj
                titul.
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function TagGroup({
  label,
  tags,
  color,
}: {
  label: string;
  tags: string[];
  color: 'blue' | 'emerald' | 'purple';
}) {
  const colorMap = {
    blue: 'bg-blue-100 text-blue-800',
    emerald: 'bg-emerald-100 text-emerald-800',
    purple: 'bg-purple-100 text-purple-800',
  };
  return (
    <div>
      <div className="mb-1 text-xs font-medium uppercase text-muted-foreground">{label}</div>
      <div className="flex flex-wrap gap-1">
        {tags.length === 0 ? (
          <span className="text-xs text-muted-foreground">—</span>
        ) : (
          tags.map((t) => (
            <span
              key={t}
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${colorMap[color]}`}
            >
              {t}
            </span>
          ))
        )}
      </div>
    </div>
  );
}
