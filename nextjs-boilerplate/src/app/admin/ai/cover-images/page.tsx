'use client';

import { FormEvent, useState } from 'react';
import { PageHeader } from '@/components/admin/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

interface Variant {
  url: string;
  prompt: string;
  provider: 'stub' | 'dalle3' | 'fal' | 'sd';
}

const VIBES = [
  { id: 'energetic', label: '⚡ Energetic (rock, EDM, sport)' },
  { id: 'elegant', label: '🎭 Elegant (opera, klasika, divadlo)' },
  { id: 'underground', label: '🌃 Underground (klub, indie)' },
  { id: 'family', label: '👨‍👩‍👧 Family (děti, rodinná)' },
  { id: 'classical', label: '🎼 Classical (filharmonie)' },
];

const CATEGORIES = [
  'concert',
  'festival',
  'theatre',
  'club_party',
  'sports',
  'conference',
  'workshop',
  'family',
  'comedy',
  'other',
];

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

export default function CoverImagesPage() {
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('concert');
  const [vibe, setVibe] = useState<string>('energetic');
  const [variants, setVariants] = useState<Variant[]>([]);
  const [mode, setMode] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  async function generate(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setVariants([]);
    try {
      const res = await authFetch('/api/admin/ai/cover-image', {
        method: 'POST',
        body: JSON.stringify({ title, category, vibe }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        variants?: Variant[];
        mode?: string;
        error?: string;
      };
      if (!res.ok) {
        setError(j.error ?? `HTTP ${res.status}`);
        return;
      }
      setVariants(j.variants ?? []);
      setMode(j.mode ?? '');
    } finally {
      setBusy(false);
    }
  }

  function copyUrl(url: string) {
    if (typeof navigator !== 'undefined') {
      void navigator.clipboard.writeText(url);
      setCopied(url);
      setTimeout(() => setCopied(null), 2000);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="🎨 AI cover image generator"
        description="Z titulu + tagů vygeneruje 4 cover varianty. Vyber a zkopíruj URL do event editoru."
      />

      {error ? (
        <div className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">
          {error}
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Generate</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={generate} className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div className="md:col-span-3">
              <label className="mb-1 block text-xs uppercase text-muted-foreground">
                Název akce
              </label>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Imagine Dragons — Mercury World Tour"
                required
                minLength={2}
                maxLength={200}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs uppercase text-muted-foreground">
                Kategorie
              </label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div className="md:col-span-2">
              <label className="mb-1 block text-xs uppercase text-muted-foreground">Vibe</label>
              <select
                value={vibe}
                onChange={(e) => setVibe(e.target.value)}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              >
                {VIBES.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="md:col-span-3">
              <Button type="submit" disabled={busy || title.length < 2}>
                {busy ? '⏳ Generuji 4 varianty…' : '✨ Generate covers'}
              </Button>
              {mode ? (
                <span className="ml-3 text-xs text-muted-foreground">
                  Mode: <code className="rounded bg-muted px-1">{mode}</code>
                  {mode === 'stub' ? ' (demo — nastavte OPENAI_API_KEY pro DALL-E 3)' : ''}
                </span>
              ) : null}
            </div>
          </form>
        </CardContent>
      </Card>

      {variants.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Varianty ({variants.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {variants.map((v, i) => (
                <div key={i} className="space-y-2 rounded-md border bg-card p-3">
                  <div className="overflow-hidden rounded-md bg-muted/30">
                    <img
                      src={v.url}
                      alt={`Variant ${i + 1}`}
                      className="block w-full"
                      style={{ aspectRatio: '16 / 9', objectFit: 'cover' }}
                    />
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Variant {i + 1} · <code className="rounded bg-muted px-1">{v.provider}</code>
                  </div>
                  <details className="text-xs">
                    <summary className="cursor-pointer text-muted-foreground">prompt</summary>
                    <p className="mt-1 italic">{v.prompt}</p>
                  </details>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => copyUrl(v.url)} variant="outline">
                      {copied === v.url ? '✓ Zkopírováno' : '📋 Copy URL'}
                    </Button>
                    <a
                      href={v.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center text-xs text-primary hover:underline"
                    >
                      Otevřít plnou velikost →
                    </a>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
