import { notFound } from 'next/navigation';
import { Pool } from 'pg';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { pgPoolOptions } from '@/lib/db/pg-options';
import { formatMoney } from '@/lib/format';
import { CrossPassBuyer } from './CrossPassBuyer';

export const dynamic = 'force-dynamic';

interface BundleRow {
  id: string;
  name: string;
  description: string | null;
  price_halire: number;
  remaining_qty: number | null;
  starts_at: string | null;
  ends_at: string | null;
  active: boolean;
  promoter_name: string | null;
}

interface EventRow {
  event_id: string;
  title: string;
  date_start: string;
  venue_name: string | null;
}

async function fetchBundle(id: string) {
  const db = new Pool(pgPoolOptions(process.env.DATABASE_URL));
  try {
    const b = await db.query<BundleRow>(
      `SELECT b.id, b.name, b.description, b.price_halire, b.remaining_qty,
              b.starts_at, b.ends_at, b.active, p.name AS promoter_name
       FROM catalog.cross_pass_bundles b
       LEFT JOIN platform.promoters p ON p.id = b.promoter_id
       WHERE b.id = $1 AND b.active = true`,
      [id],
    );
    if (b.rows.length === 0) return null;
    const events = await db.query<EventRow>(
      `SELECT cpe.event_id, e.title, e.date_start, v.name AS venue_name
       FROM catalog.cross_pass_events cpe
       JOIN catalog.events e ON e.id = cpe.event_id
       LEFT JOIN catalog.venues v ON v.id = e.venue_id
       WHERE cpe.bundle_id = $1
       ORDER BY cpe.display_order, e.date_start`,
      [id],
    );
    return { bundle: b.rows[0], events: events.rows };
  } finally {
    await db.end();
  }
}

export default async function CrossPassPage(
  props: {
    params: Promise<{ locale: string; id: string }>;
  }
) {
  const params = await props.params;
  const data = await fetchBundle(params.id);
  if (!data) notFound();
  const { bundle, events } = data;
  const soldOut = bundle.remaining_qty !== null && bundle.remaining_qty < 1;

  return (
    <div className="mx-auto max-w-2xl space-y-6 py-8">
      <div>
        <h1 className="text-3xl font-bold">{bundle.name}</h1>
        {bundle.promoter_name ? (
          <p className="mt-1 text-sm text-muted-foreground">{bundle.promoter_name}</p>
        ) : null}
        {bundle.description ? (
          <p className="mt-3 text-sm leading-relaxed whitespace-pre-line">
            {bundle.description}
          </p>
        ) : null}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Co je v pasu</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="divide-y">
            {events.map((e) => (
              <li key={e.event_id} className="py-2 text-sm">
                <div className="font-medium">{e.title}</div>
                <div className="text-xs text-muted-foreground">
                  {new Date(e.date_start).toLocaleString('cs-CZ', {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  })}
                  {e.venue_name ? ` · ${e.venue_name}` : ''}
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-muted-foreground">
            Cross-pass platí pro všech {events.length} akcí. Při scan na bráně se uloží
            redemption per akce; nelze použít 2× na stejnou akci.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Cena a koupit</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="mb-3 flex items-baseline justify-between">
            <span className="text-2xl font-bold">{formatMoney(bundle.price_halire, 'CZK')}</span>
            {bundle.remaining_qty !== null ? (
              <span className="text-xs text-muted-foreground">
                {bundle.remaining_qty} dostupných
              </span>
            ) : null}
          </div>
          {bundle.starts_at || bundle.ends_at ? (
            <p className="mb-3 text-xs text-muted-foreground">
              Platí
              {bundle.starts_at
                ? ` od ${new Date(bundle.starts_at).toLocaleDateString('cs-CZ')}`
                : ''}
              {bundle.ends_at
                ? ` do ${new Date(bundle.ends_at).toLocaleDateString('cs-CZ')}`
                : ''}
              .
            </p>
          ) : null}
          {soldOut ? (
            <p className="rounded-md border bg-rose-50 p-3 text-sm text-rose-900">
              Vyprodáno.
            </p>
          ) : (
            <CrossPassBuyer bundleId={bundle.id} locale={params.locale} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
