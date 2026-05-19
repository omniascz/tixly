'use client';

import { FormEvent, useState } from 'react';
import { PageHeader } from '@/components/admin/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

interface Variant {
  text: string;
  tone: 'energetic' | 'elegant' | 'informative';
  provider: 'openai' | 'stub';
}

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

const LANGS = [
  { id: 'cs', name: 'Čeština' },
  { id: 'en', name: 'English' },
  { id: 'de', name: 'Deutsch' },
  { id: 'fr', name: 'Français' },
  { id: 'nl', name: 'Nederlands' },
  { id: 'es', name: 'Español' },
  { id: 'pl', name: 'Polski' },
  { id: 'sk', name: 'Slovenčina' },
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

export default function DescriptionToolPage() {
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('concert');
  const [venue, setVenue] = useState('');
  const [language, setLanguage] = useState('cs');
  const [extraContext, setExtraContext] = useState('');
  const [variants, setVariants] = useState<Variant[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<number | null>(null);

  async function generate(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setVariants([]);
    try {
      const res = await authFetch('/api/admin/ai/description', {
        method: 'POST',
        body: JSON.stringify({
          title,
          category,
          venue: venue || undefined,
          language,
          extraContext: extraContext || undefined,
        }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        variants?: Variant[];
        error?: string;
      };
      if (!res.ok) {
        setError(j.error ?? `HTTP ${res.status}`);
        return;
      }
      setVariants(j.variants ?? []);
    } finally {
      setBusy(false);
    }
  }

  function copy(text: string, idx: number) {
    if (typeof navigator !== 'undefined') {
      void navigator.clipboard.writeText(text);
      setCopied(idx);
      setTimeout(() => setCopied(null), 2000);
    }
  }

  const TONE_LABEL: Record<string, string> = {
    energetic: '⚡ Energetic',
    elegant: '🎭 Elegant',
    informative: '📋 Informative',
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="✍️ AI description generator"
        description="Z titulu + kategorie vygeneruje 3 varianty popisu události v požadovaném jazyce."
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
          <form onSubmit={generate} className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="md:col-span-2">
              <label className="mb-1 block text-xs uppercase text-muted-foreground">
                Název akce
              </label>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                minLength={2}
                maxLength={200}
                placeholder="Coldplay — Music of the Spheres Tour"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs uppercase text-muted-foreground">Kategorie</label>
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
            <div>
              <label className="mb-1 block text-xs uppercase text-muted-foreground">Jazyk</label>
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              >
                {LANGS.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="md:col-span-2">
              <label className="mb-1 block text-xs uppercase text-muted-foreground">
                Sál (volitelné)
              </label>
              <Input
                value={venue}
                onChange={(e) => setVenue(e.target.value)}
                placeholder="O2 Arena, Praha"
              />
            </div>
            <div className="md:col-span-2">
              <label className="mb-1 block text-xs uppercase text-muted-foreground">
                Extra kontext (volitelné — interpreti, speciální hosté, atd.)
              </label>
              <textarea
                value={extraContext}
                onChange={(e) => setExtraContext(e.target.value)}
                rows={2}
                maxLength={500}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              />
            </div>
            <div className="md:col-span-2">
              <Button type="submit" disabled={busy || title.length < 2}>
                {busy ? '⏳ Píšu 3 varianty…' : '✨ Generate descriptions'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {variants.length > 0 ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {variants.map((v, i) => (
            <Card key={i}>
              <CardHeader>
                <CardTitle className="flex items-center justify-between text-sm">
                  <span>{TONE_LABEL[v.tone]}</span>
                  <code className="rounded bg-muted px-1 text-[10px]">{v.provider}</code>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm leading-relaxed whitespace-pre-line">{v.text}</p>
                <div className="text-xs text-muted-foreground">{v.text.length} znaků</div>
                <Button size="sm" variant="outline" onClick={() => copy(v.text, i)}>
                  {copied === i ? '✓ Zkopírováno' : '📋 Copy'}
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : null}
    </div>
  );
}
