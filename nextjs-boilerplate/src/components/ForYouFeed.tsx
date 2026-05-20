'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Sparkles } from 'lucide-react';
import { typedGet } from '@/lib/typed-fetch';

interface Recommendation {
  id: string;
  title: string;
  slug: string | null;
  date_start: string;
  city: string | null;
  venue_name: string | null;
  cover_image: string | null;
  promoter_name: string | null;
  cheapest_price_halire: number | null;
  reasons: string[];
}

const STRINGS = {
  cs: {
    title: '✨ Doporučeno pro tebe',
    subtitleAnon: 'Trendující akce — přihlas se pro personalizované doporučení',
    subtitleAuth: 'Vybráno podle tvých nákupů a sledovaných promotérů',
    from: 'od',
    reason_trending: 'aktuální trend',
    reason_followed: 'sledovaný promotér',
    reason_similar: 'podobné akce',
    reason_city: 'tvé město',
    reason_price: 'tvá cenová úroveň',
  },
  sk: {
    title: '✨ Odporúčané pre teba',
    subtitleAnon: 'Trendujúce akcie — prihlás sa pre personalizované odporúčania',
    subtitleAuth: 'Vybrané podľa tvojich nákupov a sledovaných organizátorov',
    from: 'od',
    reason_trending: 'aktuálny trend',
    reason_followed: 'sledovaný organizátor',
    reason_similar: 'podobné akcie',
    reason_city: 'tvoje mesto',
    reason_price: 'tvoja cenová úroveň',
  },
  en: {
    title: '✨ Recommended for you',
    subtitleAnon: 'Trending now — sign in for personalized picks',
    subtitleAuth: 'Picked based on your purchases and followed organizers',
    from: 'from',
    reason_trending: 'trending now',
    reason_followed: 'followed organizer',
    reason_similar: 'similar event',
    reason_city: 'your city',
    reason_price: 'your price range',
  },
} as const;

function formatPrice(halire: number | null, locale: string): string {
  if (halire === null) return '';
  const kc = halire / 100;
  return kc.toLocaleString(locale === 'sk' ? 'sk-SK' : 'cs-CZ', { maximumFractionDigits: 0 });
}

function formatDate(iso: string, locale: string): string {
  return new Date(iso).toLocaleString(locale === 'sk' ? 'sk-SK' : 'cs-CZ', {
    day: 'numeric',
    month: 'short',
  });
}

type Strings = (typeof STRINGS)[keyof typeof STRINGS];

function mapReason(reason: string, t: Strings): string | null {
  if (reason.includes('followed') || reason.includes('promotér')) return t.reason_followed;
  if (reason.includes('trending') || reason.includes('trend')) return t.reason_trending;
  if (reason.includes('event_type') || reason.includes('similar')) return t.reason_similar;
  if (reason.includes('city') || reason.includes('město')) return t.reason_city;
  if (reason.includes('price')) return t.reason_price;
  return null;
}

export function ForYouFeed({ locale }: { locale: 'cs' | 'sk' | 'en' }) {
  const t = STRINGS[locale] ?? STRINGS.cs;
  const [recs, setRecs] = useState<Recommendation[]>([]);
  const [authenticated, setAuthenticated] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    try {
      const data = await typedGet<{ events?: Recommendation[]; authenticated?: boolean }>(
        '/api/buyer/recommendations?limit=6',
      );
      setRecs(data.events ?? []);
      setAuthenticated(data.authenticated ?? false);
    } catch {
      // Bez user nebo s error: skipnout sekci úplně
    } finally {
      setLoaded(true);
    }
  }

  if (!loaded || recs.length === 0) return null;

  return (
    <section aria-labelledby="for-you-heading">
      <div className="mb-3 flex items-baseline justify-between">
        <div>
          <h2 id="for-you-heading" className="text-2xl font-semibold">
            {t.title}
          </h2>
          <p className="text-xs text-muted-foreground">
            {authenticated ? t.subtitleAuth : t.subtitleAnon}
          </p>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {recs.slice(0, 6).map((rec) => (
          <Link
            key={rec.id}
            href={`/${locale}/events/${rec.slug ?? rec.id}`}
            className="group flex gap-3 rounded-lg border bg-card p-3 transition hover:shadow-md"
          >
            <div
              className="h-20 w-20 flex-shrink-0 rounded-md bg-gradient-to-br from-violet-100 to-fuchsia-100"
              style={
                rec.cover_image
                  ? { backgroundImage: `url("${rec.cover_image}")`, backgroundSize: 'cover' }
                  : undefined
              }
            />
            <div className="min-w-0 flex-1">
              <p className="text-xs uppercase text-muted-foreground">
                {formatDate(rec.date_start, locale)}
              </p>
              <h3 className="line-clamp-2 text-sm font-semibold group-hover:text-primary">
                {rec.title}
              </h3>
              {rec.venue_name ? (
                <p className="line-clamp-1 text-xs text-muted-foreground">
                  {rec.venue_name}
                  {rec.city ? `, ${rec.city}` : ''}
                </p>
              ) : null}
              <div className="mt-1 flex items-center justify-between gap-1 text-[11px]">
                {rec.cheapest_price_halire !== null ? (
                  <span className="font-medium text-primary">
                    {t.from} {formatPrice(rec.cheapest_price_halire, locale)} Kč
                  </span>
                ) : (
                  <span />
                )}
                {rec.reasons[0] ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 text-violet-700">
                    <Sparkles className="h-2.5 w-2.5" aria-hidden />
                    {mapReason(rec.reasons[0], t) ?? rec.reasons[0]}
                  </span>
                ) : null}
              </div>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
