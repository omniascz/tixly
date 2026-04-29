'use client';

import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { formatMoney, isCurrency } from '@/lib/format';

interface ParsedIntent {
  audienceTag?: string;
  vibeTag?: string;
  genreTag?: string;
  city?: string;
  maxPriceMinor?: number;
  dateRange?: string;
  category?: string;
  keywords: string[];
}

interface Result {
  eventId: string;
  title: string;
  date_start: string;
  venue_name: string | null;
  category: string;
  min_price: number | null;
  currency: string;
  matchScore: number;
  matchedReasons: string[];
}

const DATE_LABELS: Record<string, string> = {
  today: 'dnes',
  tomorrow: 'zítra',
  this_weekend: 'tento víkend',
  this_week: 'tento týden',
  next_week: 'příští týden',
  this_month: 'tento měsíc',
};

export function SearchClient({
  locale,
  initialQuery,
}: {
  locale: string;
  initialQuery: string;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [intent, setIntent] = useState<ParsedIntent | null>(null);
  const [results, setResults] = useState<Result[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initialQuery) void search(initialQuery);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function search(q: string) {
    if (q.length < 2) return;
    setBusy(true);
    setError(null);
    setResults(null);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
      if (!res.ok) {
        setError(`HTTP ${res.status}`);
        return;
      }
      const j = (await res.json()) as { intent: ParsedIntent; results: Result[] };
      setIntent(j.intent);
      setResults(j.results);
      // Update URL
      if (typeof window !== 'undefined') {
        const url = new URL(window.location.href);
        url.searchParams.set('q', q);
        window.history.replaceState({}, '', url.toString());
      }
    } finally {
      setBusy(false);
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    await search(query);
  }

  return (
    <div className="space-y-6">
      <form onSubmit={onSubmit} className="flex gap-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="rock koncert příští týden v Praze"
          className="flex-1"
          required
          minLength={2}
        />
        <Button type="submit" disabled={busy}>
          {busy ? 'Hledám…' : 'Hledat'}
        </Button>
      </form>

      {error ? (
        <div className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">
          {error}
        </div>
      ) : null}

      {intent ? (
        <div className="rounded-md border bg-muted/30 p-3">
          <h3 className="mb-2 text-sm font-medium">🤖 Pochopil jsem dotaz jako:</h3>
          <div className="flex flex-wrap gap-1">
            {intent.category ? <Pill label={`Kategorie: ${intent.category}`} /> : null}
            {intent.audienceTag ? <Pill label={`Publikum: ${intent.audienceTag}`} /> : null}
            {intent.vibeTag ? <Pill label={`Vibe: ${intent.vibeTag}`} /> : null}
            {intent.genreTag ? <Pill label={`Žánr: ${intent.genreTag}`} /> : null}
            {intent.city ? <Pill label={`Město: ${intent.city}`} /> : null}
            {intent.dateRange ? (
              <Pill label={`Datum: ${DATE_LABELS[intent.dateRange] ?? intent.dateRange}`} />
            ) : null}
            {intent.maxPriceMinor !== undefined ? (
              <Pill label={`Max ${intent.maxPriceMinor / 100} Kč`} />
            ) : null}
            {intent.keywords.length > 0 ? (
              <Pill label={`Keywords: ${intent.keywords.slice(0, 4).join(', ')}`} />
            ) : null}
          </div>
        </div>
      ) : null}

      {results !== null ? (
        results.length === 0 ? (
          <p className="rounded-md border bg-muted/20 p-6 text-center text-sm text-muted-foreground">
            Žádné výsledky. Zkus jiný dotaz nebo méně specifické filtry.
          </p>
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">{results.length} výsledků</p>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {results.map((r) => {
                const ccy = isCurrency(r.currency) ? r.currency : 'CZK';
                return (
                  <Link
                    key={r.eventId}
                    href={`/${locale}/events/${r.eventId}`}
                    className="rounded-lg border bg-card p-3 transition hover:bg-muted/30"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="font-medium">{r.title}</h3>
                      <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] text-emerald-800">
                        {Math.round(r.matchScore * 100)}%
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {new Date(r.date_start).toLocaleDateString('cs-CZ', {
                        day: 'numeric',
                        month: 'long',
                        year: 'numeric',
                      })}
                      {r.venue_name ? ` · ${r.venue_name}` : ''}
                    </div>
                    {r.min_price !== null ? (
                      <div className="mt-1 text-sm font-medium">
                        od {formatMoney(r.min_price, ccy)}
                      </div>
                    ) : null}
                    {r.matchedReasons.length > 0 ? (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {r.matchedReasons.slice(0, 3).map((reason, i) => (
                          <span
                            key={i}
                            className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
                          >
                            {reason}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </Link>
                );
              })}
            </div>
          </div>
        )
      ) : null}
    </div>
  );
}

function Pill({ label }: { label: string }) {
  return (
    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
      {label}
    </span>
  );
}
