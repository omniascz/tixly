'use client';

import { FormEvent, useState } from 'react';
import { PageHeader } from '@/components/admin/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

interface Post {
  platform: 'facebook' | 'instagram' | 'twitter';
  text: string;
  hashtags: string[];
  characterCount: number;
  provider: 'openai' | 'stub';
}

const CATEGORIES = ['concert', 'festival', 'theatre', 'club_party', 'sports', 'conference', 'workshop', 'family', 'comedy', 'other'];

const PLATFORM_INFO: Record<string, { emoji: string; name: string; color: string; charLimit?: number }> = {
  facebook: { emoji: '📘', name: 'Facebook', color: 'bg-blue-100 text-blue-900', charLimit: 63206 },
  instagram: { emoji: '📷', name: 'Instagram', color: 'bg-pink-100 text-pink-900', charLimit: 2200 },
  twitter: { emoji: '𝕏', name: 'Twitter / X', color: 'bg-slate-200 text-slate-900', charLimit: 280 },
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

export default function SocialPostsToolPage() {
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('concert');
  const [venue, setVenue] = useState('');
  const [url, setUrl] = useState('');
  const [language, setLanguage] = useState<'cs' | 'en'>('cs');
  const [posts, setPosts] = useState<Post[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  async function generate(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setPosts([]);
    try {
      const res = await authFetch('/api/admin/ai/social-posts', {
        method: 'POST',
        body: JSON.stringify({
          title,
          category,
          venue: venue || undefined,
          url: url || undefined,
          language,
        }),
      });
      const j = (await res.json().catch(() => ({}))) as { posts?: Post[]; error?: string };
      if (!res.ok) {
        setError(j.error ?? `HTTP ${res.status}`);
        return;
      }
      setPosts(j.posts ?? []);
    } finally {
      setBusy(false);
    }
  }

  function copy(text: string, key: string) {
    if (typeof navigator !== 'undefined') {
      navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(null), 2000);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="📱 AI social media generator"
        description="Z eventu vygeneruje 3 platform-specific posts (Facebook + Instagram + Twitter/X) s hashtagy."
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
                placeholder="Coldplay — Music of the Spheres"
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
                onChange={(e) => setLanguage(e.target.value as 'cs' | 'en')}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              >
                <option value="cs">Čeština</option>
                <option value="en">English</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs uppercase text-muted-foreground">Sál</label>
              <Input
                value={venue}
                onChange={(e) => setVenue(e.target.value)}
                placeholder="O2 Arena, Praha"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs uppercase text-muted-foreground">URL akce</label>
              <Input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://tixly.cz/cs/events/..."
              />
            </div>
            <div className="md:col-span-2">
              <Button type="submit" disabled={busy || title.length < 2}>
                {busy ? 'Píšu posty…' : '✨ Generate posts'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {posts.length > 0 ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {posts.map((p) => {
            const info = PLATFORM_INFO[p.platform];
            const overLimit = info.charLimit && p.characterCount > info.charLimit;
            return (
              <Card key={p.platform} className={info.color}>
                <CardHeader>
                  <CardTitle className="flex items-center justify-between">
                    <span>
                      {info.emoji} {info.name}
                    </span>
                    <code className="rounded bg-white/40 px-1.5 py-0.5 text-[10px]">
                      {p.provider}
                    </code>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="whitespace-pre-line rounded-md bg-white/60 p-3 text-sm">{p.text}</p>
                  <div className={`text-xs ${overLimit ? 'text-rose-700' : ''}`}>
                    {p.characterCount} znaků
                    {info.charLimit ? ` / ${info.charLimit}` : ''}
                  </div>
                  {p.hashtags.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {p.hashtags.map((h) => (
                        <span
                          key={h}
                          className="rounded-full bg-white/50 px-2 py-0.5 text-[10px] font-medium"
                        >
                          {h}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => copy(p.text, p.platform)}
                    className="bg-white/80"
                  >
                    {copied === p.platform ? '✓ Zkopírováno' : '📋 Copy'}
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
