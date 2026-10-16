/**
 * /kiosk/[slug] — samoobslužný terminál pro promotéra
 *
 * Veřejně přístupné, bez přihlášení. URL sdílí promotér s obsluhou/zákazníky.
 * Zobrazuje nadcházející akce promotéra a umožňuje koupě bez účtu.
 */
import { notFound } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';
import { Calendar, MapPin, Ticket } from 'lucide-react';

interface EventRow {
  id: string;
  title: string;
  slug: string | null;
  starts_at: string;
  ends_at: string | null;
  venue_name: string | null;
  venue_city: string | null;
  cover_image_url: string | null;
  min_price: number | null;
  currency: string;
  remaining_capacity: number | null;
}

interface PromoterRow {
  id: string;
  name: string;
  logo_url: string | null;
}

async function getKioskData(slug: string) {
  return runWithServiceContext(async () => {
    const proRes = await db().query<PromoterRow>(
      `SELECT p.id, p.name, b.logo_url
         FROM platform.promoters p
         LEFT JOIN platform.promoter_branding b ON b.promoter_id = p.id
        WHERE p.slug = $1`,
      [slug],
    );
    const promoter = proRes.rows[0];
    if (!promoter) return null;

    const evRes = await db().query<EventRow>(
      // Kolo 9: dotaz četl neexistující sloupce (starts_at, ends_at, total_capacity, ticket_types.is_active) → stránka 500.
      `SELECT e.id, e.title, e.slug, e.date_start AS starts_at, e.date_end AS ends_at,
              v.name AS venue_name, v.city AS venue_city,
              e.cover_image_url,
              MIN(tt.base_price) AS min_price,
              e.currency,
              COALESCE(SUM(tt.remaining_qty), 0)::int AS remaining_capacity
         FROM catalog.events e
         LEFT JOIN catalog.venues v ON v.id = e.venue_id
         LEFT JOIN catalog.ticket_types tt ON tt.event_id = e.id AND tt.visibility = 'public'
        WHERE e.promoter_id = $1
          AND e.status = 'published'
          AND e.date_start > NOW()
        GROUP BY e.id, v.name, v.city
        ORDER BY e.date_start ASC
        LIMIT 20`,
      [promoter.id],
    );

    return { promoter, events: evRes.rows };
  });
}

function formatPrice(halire: number | null, currency: string) {
  if (halire == null) return 'Zdarma';
  return new Intl.NumberFormat('cs-CZ', { style: 'currency', currency, maximumFractionDigits: 0 })
    .format(halire / 100);
}

function formatDate(iso: string) {
  return new Intl.DateTimeFormat('cs-CZ', { weekday: 'short', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })
    .format(new Date(iso));
}

export default async function KioskHomePage(props: { params: Promise<{ slug: string }> }) {
  const params = await props.params;
  const data = await getKioskData(params.slug);
  if (!data) notFound();
  const { promoter, events } = data;

  return (
    <div className="flex flex-col h-screen">
      {/* Header */}
      <header className="flex items-center gap-4 px-8 py-5 border-b border-gray-800 bg-gray-900 shrink-0">
        {promoter.logo_url && (
          <Image src={promoter.logo_url} alt={promoter.name} width={48} height={48} className="rounded-lg object-contain" />
        )}
        <div>
          <h1 className="text-2xl font-bold text-white">{promoter.name}</h1>
          <p className="text-sm text-gray-400">Samoobslužná pokladna · Tixly Kiosk</p>
        </div>
        <div className="ml-auto flex items-center gap-2 text-sm text-gray-500">
          <Ticket className="h-4 w-4" />
          Vyberte akci
        </div>
      </header>

      {/* Event grid */}
      <main className="flex-1 overflow-y-auto p-8">
        {events.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-4 text-gray-500">
            <Calendar className="h-16 w-16" />
            <p className="text-xl">Žádné nadcházející akce</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 xl:grid-cols-3 gap-6">
            {events.map((ev) => (
              <Link
                key={ev.id}
                href={`/kiosk/${params.slug}/${ev.id}`}
                className="group rounded-2xl border border-gray-800 bg-gray-900 hover:border-brand-500 hover:bg-gray-800 transition-all overflow-hidden"
              >
                {ev.cover_image_url ? (
                  <div className="relative h-44 w-full">
                    <Image src={ev.cover_image_url} alt={ev.title} fill className="object-cover" />
                    <div className="absolute inset-0 bg-gradient-to-t from-gray-900/80" />
                  </div>
                ) : (
                  <div className="h-44 bg-gradient-to-br from-brand-600/20 to-gray-800 flex items-center justify-center">
                    <Ticket className="h-12 w-12 text-brand-400/50" />
                  </div>
                )}

                <div className="p-5 space-y-3">
                  <h2 className="text-lg font-semibold leading-tight text-white line-clamp-2 group-hover:text-brand-300 transition-colors">
                    {ev.title}
                  </h2>
                  <div className="space-y-1.5 text-sm text-gray-400">
                    <div className="flex items-center gap-2">
                      <Calendar className="h-4 w-4 shrink-0" />
                      {formatDate(ev.starts_at)}
                    </div>
                    {ev.venue_name && (
                      <div className="flex items-center gap-2">
                        <MapPin className="h-4 w-4 shrink-0" />
                        {ev.venue_name}{ev.venue_city ? `, ${ev.venue_city}` : ''}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center justify-between pt-2">
                    <span className="text-xl font-bold text-white">
                      {formatPrice(ev.min_price, ev.currency)}
                    </span>
                    {ev.remaining_capacity != null && ev.remaining_capacity < 20 && (
                      <span className="text-xs text-amber-400 font-medium">
                        Zbývá {ev.remaining_capacity} míst
                      </span>
                    )}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="px-8 py-3 text-center text-xs text-gray-600 border-t border-gray-800 shrink-0">
        Powered by Tixly · {new Date().toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' })}
      </footer>
    </div>
  );
}
