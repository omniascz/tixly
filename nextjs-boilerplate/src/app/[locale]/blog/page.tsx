import Link from 'next/link';
import { Pool } from 'pg';
import { Card, CardContent } from '@/components/ui/card';
import { pgPoolOptions } from '@/lib/db/pg-options';

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

async function fetchArticles(category: string | null): Promise<Article[]> {
  const db = new Pool(pgPoolOptions(process.env.DATABASE_URL));
  try {
    const args: unknown[] = [];
    let where = `WHERE status = 'published'`;
    if (category) {
      args.push(category);
      where += ` AND category = $${args.length}`;
    }
    const r = await db.query<Article>(
      `SELECT id, slug, title, excerpt, cover_image, category, reading_time_min,
              view_count, published_at::text
       FROM marketing.editorial_articles
       ${where}
       ORDER BY published_at DESC NULLS LAST
       LIMIT 50`,
      args,
    );
    return r.rows;
  } finally {
    await db.end();
  }
}

export default async function BlogIndexPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ category?: string }>;
}) {
  const { locale } = await params;
  const { category } = await searchParams;
  const articles = await fetchArticles(category ?? null);

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div>
        <h1 className="text-3xl font-bold">Tixly Magazin</h1>
        <p className="text-sm text-muted-foreground">
          Doporučené akce, rozhovory, tipy na nezapomenutelné večery.
        </p>
      </div>

      <div className="flex flex-wrap gap-2 text-sm">
        {[
          { value: null, label: 'Vše' },
          { value: 'koncerty', label: 'Koncerty' },
          { value: 'divadlo', label: 'Divadlo' },
          { value: 'festivaly', label: 'Festivaly' },
          { value: 'tips', label: 'Tipy' },
          { value: 'interview', label: 'Rozhovory' },
        ].map((c) => (
          <Link
            key={c.value ?? 'all'}
            href={c.value ? `/${locale}/blog?category=${c.value}` : `/${locale}/blog`}
            className={`rounded-full border px-3 py-1 ${
              (category ?? null) === c.value
                ? 'bg-primary text-primary-foreground'
                : 'hover:bg-muted'
            }`}
          >
            {c.label}
          </Link>
        ))}
      </div>

      {articles.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            Zatím žádné články v této kategorii.
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {articles.map((a) => (
            <Link
              key={a.id}
              href={`/${locale}/blog/${a.slug}`}
              className="group block overflow-hidden rounded-lg border bg-card transition hover:shadow-md"
            >
              {a.cover_image ? (
                <div
                  className="aspect-video bg-cover bg-center"
                  style={{ backgroundImage: `url(${a.cover_image})` }}
                />
              ) : (
                <div className="aspect-video bg-gradient-to-br from-emerald-100 to-blue-100" />
              )}
              <div className="p-4">
                {a.category ? (
                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs uppercase tracking-wide">
                    {a.category}
                  </span>
                ) : null}
                <h2 className="mt-2 text-lg font-semibold group-hover:text-primary">{a.title}</h2>
                {a.excerpt ? (
                  <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{a.excerpt}</p>
                ) : null}
                <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
                  <span>{new Date(a.published_at).toLocaleDateString('cs-CZ')}</span>
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
