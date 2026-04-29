'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { formatMoney, isCurrency } from '@/lib/format';

interface Rec {
  id: string;
  title: string;
  date_start: string;
  venue_name: string | null;
  category: string;
  min_price: number | null;
  currency: string;
  reason: 'co_occurrence' | 'same_category' | 'same_venue' | 'similar_price';
}

const REASON_LABELS: Record<string, string> = {
  co_occurrence: 'Lidé z této akce si koupili také',
  same_venue: 'Stejné místo',
  same_category: 'Podobná kategorie',
  similar_price: 'Podobná cena',
};

export function Recommendations({ eventId, locale }: { eventId: string; locale: string }) {
  const [recs, setRecs] = useState<Rec[] | null>(null);

  useEffect(() => {
    void load();
    async function load() {
      try {
        const res = await fetch(`/api/events/${eventId}/recommendations`);
        if (res.ok) {
          const j = (await res.json()) as { recommendations: Rec[] };
          setRecs(j.recommendations);
        } else {
          setRecs([]);
        }
      } catch {
        setRecs([]);
      }
    }
  }, [eventId]);

  if (!recs || recs.length === 0) return null;

  // Group by reason
  const groups = new Map<string, Rec[]>();
  for (const r of recs) {
    const arr = groups.get(r.reason) ?? [];
    arr.push(r);
    groups.set(r.reason, arr);
  }
  const primaryReason = recs[0]!.reason;
  const heading = REASON_LABELS[primaryReason] ?? 'Mohlo by tě zajímat';

  return (
    <div className="space-y-3">
      <h2 className="text-lg font-semibold">{heading}</h2>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
        {recs.map((r) => {
          const ccy = isCurrency(r.currency) ? r.currency : 'CZK';
          return (
            <Link
              key={r.id}
              href={`/${locale}/events/${r.id}`}
              className="rounded-lg border bg-card p-3 transition hover:bg-muted/30"
            >
              <div className="font-medium">{r.title}</div>
              <div className="mt-1 text-xs text-muted-foreground">
                {new Date(r.date_start).toLocaleDateString('cs-CZ', {
                  day: 'numeric',
                  month: 'long',
                })}
                {r.venue_name ? ` · ${r.venue_name}` : ''}
              </div>
              {r.min_price !== null ? (
                <div className="mt-2 text-sm font-medium">
                  od {formatMoney(r.min_price, ccy)}
                </div>
              ) : null}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
