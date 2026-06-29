'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Button } from '@/components/ui/button';

interface Article {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  body_html: string;
  cover_image: string | null;
  category: string | null;
  reading_time_min: number | null;
  view_count: number;
  published_at: string;
}

interface RelatedEvent {
  id: string;
  title: string;
  slug: string | null;
  date_start: string;
  cover_image_url: string | null;
  city: string | null;
  venue_name: string | null;
  min_price_halire: number | null;
  currency: string;
}

function dateLabel(iso: string): string {
  return new Date(iso).toLocaleDateString('cs-CZ', { day: 'numeric', month: 'long', year: 'numeric' });
}

export default function EditorialArticlePage() {
  const params = useParams();
  const locale = (params?.locale as string) ?? 'cs';
  const slug = params?.slug as string;

  const [article, setArticle] = useState<Article | null>(null);
  const [events, setEvents] = useState<RelatedEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!slug) return;
    fetch(`/api/editorial/articles/${slug}`)
      .then((r) => {
        if (r.status === 404) { setNotFound(true); return null; }
        return r.json();
      })
      .then((d: { article: Article; events: RelatedEvent[] } | null) => {
        if (d) {
          setArticle(d.article);
          setEvents(d.events ?? []);
        }
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [slug]);

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-20 text-center">
        <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (notFound || !article) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-20 text-center">
        <p className="text-2xl font-bold">Článek nenalezen</p>
        <p className="mt-2 text-muted-foreground">Článek mohl být odstraněn nebo jeho adresa se změnila.</p>
        <Button asChild className="mt-6">
          <Link href={`/${locale}/editorial`}>Zpět na přehled</Link>
        </Button>
      </div>
    );
  }

  const ccy = (currency: string) => currency === 'EUR' ? '€' : 'Kč';

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      {/* Breadcrumb */}
      <nav className="mb-6 text-sm text-muted-foreground">
        <Link href={`/${locale}/editorial`} className="hover:text-foreground">Tipy redakce</Link>
        {article.category ? (
          <>
            {' / '}
            <Link href={`/${locale}/editorial?category=${article.category}`} className="hover:text-foreground">
              {article.category}
            </Link>
          </>
        ) : null}
      </nav>

      {/* Hero */}
      {article.cover_image ? (
        <div className="mb-8 overflow-hidden rounded-2xl">
          <img src={article.cover_image} alt={article.title} className="w-full object-cover" />
        </div>
      ) : null}

      <h1 className="text-4xl font-extrabold leading-tight tracking-tight">{article.title}</h1>

      <div className="mt-3 flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
        {article.category ? (
          <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
            {article.category}
          </span>
        ) : null}
        <span>{dateLabel(article.published_at)}</span>
        {article.reading_time_min ? <span>{article.reading_time_min} min čtení</span> : null}
        <span>{article.view_count.toLocaleString('cs-CZ')} zobrazení</span>
      </div>

      {article.excerpt ? (
        <p className="mt-6 text-xl leading-relaxed text-muted-foreground">{article.excerpt}</p>
      ) : null}

      {/* Body */}
      <div
        className="prose prose-lg mt-8 max-w-none dark:prose-invert"
        dangerouslySetInnerHTML={{ __html: article.body_html }}
      />

      {/* Doporučené akce */}
      {events.length > 0 ? (
        <section className="mt-12">
          <h2 className="mb-4 text-xl font-bold">Akce v článku</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {events.map((e) => {
              const href = e.slug
                ? `/${locale}/events/${e.slug}`
                : `/${locale}/events?id=${e.id}`;
              return (
                <Link
                  key={e.id}
                  href={href}
                  className="flex gap-3 rounded-xl border bg-card p-4 shadow-sm transition-shadow hover:shadow-md"
                >
                  {e.cover_image_url ? (
                    <img
                      src={e.cover_image_url}
                      alt={e.title}
                      className="h-16 w-16 shrink-0 rounded-lg object-cover"
                    />
                  ) : (
                    <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg bg-muted text-2xl">
                      🎭
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{e.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(e.date_start).toLocaleDateString('cs-CZ', { day: 'numeric', month: 'short', year: 'numeric' })}
                      {e.venue_name ? ` · ${e.venue_name}` : ''}
                      {e.city ? ` · ${e.city}` : ''}
                    </p>
                    {e.min_price_halire != null ? (
                      <p className="mt-1 text-sm font-bold">
                        od {(e.min_price_halire / 100).toLocaleString('cs-CZ')} {ccy(e.currency)}
                      </p>
                    ) : null}
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      ) : null}

      {/* Zpět */}
      <div className="mt-12 border-t pt-6">
        <Button variant="outline" asChild>
          <Link href={`/${locale}/editorial`}>← Zpět na přehled</Link>
        </Button>
      </div>
    </div>
  );
}
