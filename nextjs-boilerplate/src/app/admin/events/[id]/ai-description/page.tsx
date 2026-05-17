'use client';

import { use, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/admin/PageHeader';

interface Variant {
  kind: 'short' | 'medium' | 'long';
  text: string;
}

interface GenerateResult {
  provider: 'claude' | 'template' | 'template_fallback';
  variants: Variant[];
  error?: string;
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

const TONE_LABELS: Record<string, string> = {
  casual: '😊 Přátelský',
  professional: '👔 Profesionální',
  energetic: '⚡ Energický',
};

const KIND_LABELS: Record<Variant['kind'], string> = {
  short: 'Krátký (~200 zn.)',
  medium: 'Střední (~500 zn.)',
  long: 'Dlouhý (~1500 zn.)',
};

export default function AiDescriptionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: eventId } = use(params);
  const [keywordsRaw, setKeywordsRaw] = useState('');
  const [tone, setTone] = useState<'casual' | 'professional' | 'energetic'>('professional');
  const [language, setLanguage] = useState<'cs' | 'en'>('cs');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<GenerateResult | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  async function generate(): Promise<void> {
    const keywords = keywordsRaw
      .split(/[,\n]+/)
      .map((k) => k.trim())
      .filter((k) => k.length > 0);
    if (keywords.length === 0) {
      setError('Zadej alespoň jedno klíčové slovo.');
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await authFetch(`/api/admin/events/${eventId}/ai-description`, {
        method: 'POST',
        body: JSON.stringify({ keywords, tone, language }),
      });
      const j = (await res.json().catch(() => ({}))) as GenerateResult & {
        error?: string;
        message?: string;
      };
      if (!res.ok) {
        setError(j.message ?? j.error ?? `HTTP ${res.status}`);
        return;
      }
      setResult(j);
    } finally {
      setBusy(false);
    }
  }

  async function copyToClipboard(text: string, kind: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(kind);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      // ignore
    }
  }

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="AI popis akce"
        description="Vygeneruj 3 varianty popisu (krátký / střední / dlouhý) přes Claude AI. Bez ANTHROPIC_API_KEY env vrací template fallback."
      />

      <Card>
        <CardHeader>
          <CardTitle>Vstup</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium">
              Klíčová slova (odděl čárkou nebo Enter)
            </label>
            <textarea
              value={keywordsRaw}
              onChange={(e) => setKeywordsRaw(e.target.value)}
              rows={3}
              className="w-full rounded-md border bg-background p-2 text-sm"
              placeholder="koncert, jazz, intimní atmosféra, vystoupení host, večerní…"
              maxLength={500}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium">Tón</label>
              <select
                value={tone}
                onChange={(e) =>
                  setTone(e.target.value as 'casual' | 'professional' | 'energetic')
                }
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              >
                {Object.entries(TONE_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Jazyk</label>
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value as 'cs' | 'en')}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              >
                <option value="cs">🇨🇿 Česky</option>
                <option value="en">🇬🇧 English</option>
              </select>
            </div>
          </div>
          <Button onClick={generate} disabled={busy}>
            {busy ? 'Generuji…' : '✨ Vygenerovat 3 varianty'}
          </Button>
        </CardContent>
      </Card>

      {error ? (
        <div className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">
          {error}
        </div>
      ) : null}

      {result ? (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Provider: <strong>{result.provider}</strong>
            {result.provider === 'template_fallback'
              ? ' (Claude API selhalo, zobrazen template fallback)'
              : result.provider === 'template'
                ? ' (ANTHROPIC_API_KEY není nastaven)'
                : ''}
          </p>
          {result.variants.map((v) => (
            <Card key={v.kind}>
              <CardHeader className="flex flex-row items-center justify-between gap-2">
                <CardTitle className="text-base">{KIND_LABELS[v.kind]}</CardTitle>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    {v.text.length} zn.
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => copyToClipboard(v.text, v.kind)}
                  >
                    {copied === v.kind ? '✓ Zkopírováno' : 'Kopírovat'}
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <p className="whitespace-pre-wrap text-sm leading-relaxed">{v.text}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : null}

      <Card>
        <CardContent className="p-4 text-xs text-muted-foreground">
          <strong>Tip:</strong> Zkopíruj variantu do <em>Akce → Editovat → Popis</em>.
          Před publikací zkontroluj a uprav stylistiku — AI generování slouží jako
          startovní bod, ne finální verze.
        </CardContent>
      </Card>
    </div>
  );
}
