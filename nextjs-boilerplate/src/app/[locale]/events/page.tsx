import Link from 'next/link';
import { Pool } from 'pg';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { formatCzechDate } from '@/lib/format';
import {
  TOP_CATEGORIES,
  TOP_CATEGORY_MAP,
  FORMATS,
  getSubLabel,
} from '@/lib/events/categories';

interface EventRow {
  id: string;
  title: string;
  slug: string | null;
  date_start: string;
  venue_name: string;
  category: string | null;
  subcategory: string | null;
}

async function fetchEvents(filter: {
  category?: string;
  subcategory?: string;
  format?: string;
}): Promise<EventRow[]> {
  const db = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const conditions: string[] = [
      `e.date_start >= NOW()`,
      `p.status = 'active'`,
      `e.status = 'published'`,
    ];
    const params: unknown[] = [];
    if (filter.category) {
      params.push(filter.category);
      conditions.push(`e.category = $${params.length}`);
    }
    if (filter.subcategory) {
      params.push(filter.subcategory);
      conditions.push(`e.subcategory = $${params.length}`);
    }
    if (filter.format) {
      params.push(filter.format);
      conditions.push(`e.event_type = $${params.length}`);
    }

    const result = await db.query<EventRow>(
      `SELECT e.id, e.title, e.slug, e.date_start::text,
              COALESCE(v.name, 'Online') AS venue_name,
              e.category, e.subcategory
         FROM catalog.events e
         LEFT JOIN catalog.venues v ON v.id = e.venue_id
         JOIN platform.promoters p ON p.id = e.promoter_id
        WHERE ${conditions.join(' AND ')}
        ORDER BY e.date_start ASC
        LIMIT 200`,
      params,
    );
    return result.rows;
  } finally {
    await db.end();
  }
}

export const dynamic = 'force-dynamic';

export default async function EventsPage({
  params,
  searchParams,
}: {
  params: { locale: string };
  searchParams: { category?: string; subcategory?: string; format?: string };
}) {
  const activeTop = searchParams.category && TOP_CATEGORY_MAP[searchParams.category]
    ? searchParams.category
    : null;
  const activeSub = searchParams.subcategory ?? null;
  const activeFormat = searchParams.format ?? null;

  const events = await fetchEvents({
    category: activeTop ?? undefined,
    subcategory: activeSub ?? undefined,
    format: activeFormat ?? undefined,
  });

  const activeTopObj = activeTop ? TOP_CATEGORY_MAP[activeTop] : null;

  const buildHref = (q: { category?: string | null; subcategory?: string | null; format?: string | null }): string => {
    const search = new URLSearchParams();
    if (q.category) search.set('category', q.category);
    if (q.subcategory) search.set('subcategory', q.subcategory);
    if (q.format) search.set('format', q.format);
    const qs = search.toString();
    return qs ? `/${params.locale}/events?${qs}` : `/${params.locale}/events`;
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Nadcházející akce</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {events.length} akcí v prodeji
          {activeTopObj ? ` v kategorii ${activeTopObj.label}` : ''}
          {activeSub ? ` — ${getSubLabel(activeSub)}` : ''}
        </p>
      </div>

      {/* TOP filter chips */}
      <div className="flex flex-wrap gap-2">
        <Link
          href={buildHref({})}
          className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition ${
            !activeTop
              ? 'border-primary bg-primary/10 text-primary'
              : 'bg-card hover:bg-muted/40'
          }`}
        >
          Vše
        </Link>
        {TOP_CATEGORIES.map((t) => {
          const isActive = activeTop === t.id;
          return (
            <Link
              key={t.id}
              href={buildHref({ category: t.id, format: activeFormat })}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition ${
                isActive
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'bg-card hover:bg-muted/40'
              }`}
            >
              <span aria-hidden>{t.icon}</span>
              <span>{t.label}</span>
            </Link>
          );
        })}
      </div>

      {/* SUB filter (pokud TOP vybráno) */}
      {activeTopObj ? (
        <div className="flex flex-wrap gap-2 rounded-lg border bg-muted/20 p-3">
          <span className="self-center text-xs font-medium text-muted-foreground">
            Žánr:
          </span>
          <Link
            href={buildHref({ category: activeTop, format: activeFormat })}
            className={`inline-flex items-center rounded-full border px-3 py-1 text-xs transition ${
              !activeSub
                ? 'border-primary bg-primary/10 text-primary'
                : 'bg-card hover:bg-muted/40'
            }`}
          >
            Všechny
          </Link>
          {activeTopObj.subcategories.map((s) => {
            const isActive = activeSub === s.id;
            return (
              <Link
                key={s.id}
                href={buildHref({
                  category: activeTop,
                  subcategory: s.id,
                  format: activeFormat,
                })}
                className={`inline-flex items-center rounded-full border px-3 py-1 text-xs transition ${
                  isActive
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'bg-card hover:bg-muted/40'
                }`}
              >
                {s.label}
              </Link>
            );
          })}
        </div>
      ) : null}

      {/* Format filter — separate row */}
      <div className="flex flex-wrap gap-2 text-xs">
        <span className="self-center font-medium text-muted-foreground">
          Formát:
        </span>
        <Link
          href={buildHref({ category: activeTop, subcategory: activeSub })}
          className={`inline-flex items-center rounded-full border px-3 py-1 transition ${
            !activeFormat
              ? 'border-primary bg-primary/10 text-primary'
              : 'bg-card hover:bg-muted/40'
          }`}
        >
          Vše
        </Link>
        {FORMATS.map((f) => {
          const isActive = activeFormat === f.id;
          return (
            <Link
              key={f.id}
              href={buildHref({
                category: activeTop,
                subcategory: activeSub,
                format: f.id,
              })}
              className={`inline-flex items-center rounded-full border px-3 py-1 transition ${
                isActive
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'bg-card hover:bg-muted/40'
              }`}
            >
              {f.label}
            </Link>
          );
        })}
      </div>

      {/* Event grid */}
      {events.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {activeTop || activeSub || activeFormat
            ? 'Žádné akce odpovídající filtru. Zkus jiný druh nebo žánr.'
            : 'Žádné aktivní akce. Promotér musí nejprve založit a publikovat akci.'}
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {events.map((e) => (
            <Link key={e.id} href={`/${params.locale}/events/${e.slug ?? e.id}`}>
              <Card className="h-full transition-shadow hover:shadow-md">
                <CardHeader>
                  <CardTitle className="text-base">{e.title}</CardTitle>
                  <CardDescription>{e.venue_name}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="text-sm text-muted-foreground">
                    {formatCzechDate(e.date_start)}
                  </div>
                  {e.subcategory ? (
                    <div className="mt-2 text-xs text-muted-foreground">
                      {getSubLabel(e.subcategory)}
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
