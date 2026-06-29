'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';

interface Article {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  cover_image: string | null;
  category: string | null;
  reading_time_min: number | null;
  view_count: number;
  published_at: string;
}
interface Category { category: string; cnt: string }

function dateLabel(iso: string): string {
  return new Date(iso).toLocaleDateString('cs-CZ', { day: 'numeric', month: 'long', year: 'numeric' });
}

export default function EditorialPage() {
  const params = useParams();
  const locale = (params?.locale as string) ?? 'cs';
  const [articles, setArticles] = useState<Article[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [activeCategory, setActiveCategory] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const p = new URLSearchParams({ limit: '24' });
    if (activeCategory) p.set('category', activeCategory);
    fetch(`/api/editorial/articles?${p}`)
      .then((r) => r.json())
      .then((d: { articles: Article[]; categories: Category[] }) => {
        setArticles(d.articles ?? []);
        if (!activeCategory) setCategories(d.categories ?? []);
      })
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, [activeCategory]);

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Tipy redakce</h1>
        <p className="mt-2 text-muted-foreground">
          Kurátorský výběr akcí, rozhovory s umělci a průvodci sezónou od redakce Tixly.
        </p>
      </div>

      {/* Kategorie */}
      {categories.length > 0 ? (
        <div className="mb-8 flex flex-wrap gap-2">
          <button
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
              !activeCategory ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground hover:bg-muted/70'
            }`}
            onClick={() => setActiveCategory('')}
          >
            Vše
          </button>
          {categories.map((c) => (
            <button
              key={c.category}
              className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                activeCategory === c.category
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-foreground hover:bg-muted/70'
              }`}
              onClick={() => setActiveCategory(c.category)}
            >
              {c.category} <span className="ml-1 opacity-60">{c.cnt}</span>
            </button>
          ))}
        </div>
      ) : null}

      {loading ? (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-64 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      ) : articles.length === 0 ? (
        <div className="rounded-lg border bg-muted/30 p-8 text-center">
          <p className="font-semibold">Zatím žádné články</p>
          <p className="mt-1 text-sm text-muted-foreground">Brzy zde přibudou tipy a doporučení od redakce.</p>
        </div>
      ) : (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {articles.map((a) => (
            <Link
              key={a.id}
              href={`/${locale}/editorial/${a.slug}`}
              className="group flex flex-col overflow-hidden rounded-xl border bg-card shadow-sm transition-shadow hover:shadow-md"
            >
              {a.cover_image ? (
                <div className="relative aspect-[16/9] overflow-hidden bg-muted">
                  <img
                    src={a.cover_image}
                    alt={a.title}
                    className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                  />
                  {a.category ? (
                    <span className="absolute left-3 top-3 rounded-full bg-black/60 px-2.5 py-1 text-xs font-medium text-white backdrop-blur-sm">
                      {a.category}
                    </span>
                  ) : null}
                </div>
              ) : (
                <div className="flex aspect-[16/9] items-center justify-center bg-gradient-to-br from-primary/10 to-primary/5">
                  <span className="text-4xl">📰</span>
                </div>
              )}
              <div className="flex flex-1 flex-col p-4">
                <h2 className="font-bold leading-snug group-hover:text-primary">
                  {a.title}
                </h2>
                {a.excerpt ? (
                  <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{a.excerpt}</p>
                ) : null}
                <div className="mt-auto flex items-center justify-between pt-3 text-xs text-muted-foreground">
                  <span>{dateLabel(a.published_at)}</span>
                  {a.reading_time_min ? <span>{a.reading_time_min} min čtení</span> : null}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
