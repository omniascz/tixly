'use client';

import { FormEvent, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/admin/PageHeader';

interface Result {
  decision: 'safe' | 'sensitive' | 'prohibited';
  status: 'published' | 'pending_review' | 'rejected';
  reasoning: string;
  confidence: number;
  flaggedPatterns: string[];
  provider: 'openai' | 'stub';
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

export default function ModerationToolPage() {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function check(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await authFetch('/api/admin/ai/moderate', {
        method: 'POST',
        body: JSON.stringify({ title, description: description || null }),
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
        title="🛡 AI moderation check"
        description="Pre-publish kontrola textu. Vrátí decision: safe / sensitive / prohibited s reasoning."
      />

      {error ? (
        <div className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">
          {error}
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Otestovat obsah</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={check} className="space-y-3">
            <div>
              <label className="mb-1 block text-xs uppercase text-muted-foreground">
                Název akce
              </label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} required minLength={1} maxLength={200} />
            </div>
            <div>
              <label className="mb-1 block text-xs uppercase text-muted-foreground">
                Popis (volitelné)
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={5}
                maxLength={5000}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              />
            </div>
            <Button type="submit" disabled={busy || !title}>
              {busy ? 'Kontroluji…' : '🔍 Zkontrolovat'}
            </Button>
          </form>
        </CardContent>
      </Card>

      {result ? (
        <Card
          className={
            result.decision === 'safe'
              ? 'border-emerald-300 bg-emerald-50/30'
              : result.decision === 'sensitive'
                ? 'border-amber-300 bg-amber-50/30'
                : 'border-rose-300 bg-rose-50/30'
          }
        >
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>Decision</span>
              <DecisionBadge decision={result.decision} />
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm">{result.reasoning}</p>
            <div className="grid grid-cols-2 gap-3 rounded-md bg-white/60 p-3 md:grid-cols-3">
              <Stat label="Status (auto)" value={result.status} />
              <Stat label="Confidence" value={`${Math.round(result.confidence * 100)}%`} />
              <Stat label="Provider" value={result.provider} />
            </div>
            {result.flaggedPatterns.length > 0 ? (
              <div>
                <div className="mb-1 text-xs uppercase text-muted-foreground">
                  Flagged patterns
                </div>
                <div className="flex flex-wrap gap-1">
                  {result.flaggedPatterns.map((p, i) => (
                    <code
                      key={i}
                      className="rounded bg-muted px-2 py-0.5 text-xs"
                    >
                      {p}
                    </code>
                  ))}
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function DecisionBadge({ decision }: { decision: 'safe' | 'sensitive' | 'prohibited' }) {
  const map = {
    safe: 'bg-emerald-100 text-emerald-800',
    sensitive: 'bg-amber-100 text-amber-800',
    prohibited: 'bg-rose-100 text-rose-800',
  };
  const label = { safe: '✓ Safe', sensitive: '⚠ Sensitive', prohibited: '✗ Prohibited' }[decision];
  return (
    <span className={`rounded-full px-3 py-1 text-xs font-medium ${map[decision]}`}>{label}</span>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase text-muted-foreground">{label}</div>
      <div className="mt-1 font-medium">{value}</div>
    </div>
  );
}
