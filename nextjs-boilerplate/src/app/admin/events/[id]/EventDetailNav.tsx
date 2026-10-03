'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { EVENT_TABS, EVENT_FEATURES, type EventTab } from '@/lib/admin/nav';
import { cn } from '@/lib/utils';

/**
 * Záložky akce.
 *
 * Dřív: 74 odkazů v devíti rozbalovacích <details> menu uvnitř kontejneru
 * s overflow-x-auto (což rozbalený seznam svisle ořezávalo), dvě položky
 * duplicitně, jedna vedoucí na starou implementaci, dvě hotové funkce
 * v menu úplně chyběly.
 *
 * Teď: deset záložek, jeden klik, žádné rozbalování. Jednotlivé funkce
 * jsou sekcemi uvnitř příslušné záložky — viz components/admin/SectionHub.
 */
export function EventDetailNav({ eventId }: { eventId: string }): JSX.Element {
  const pathname = usePathname();
  const base = `/admin/events/${eventId}`;

  /** Poslední segment cesty, prázdný na přehledu akce. */
  const rest = pathname.startsWith(base) ? pathname.slice(base.length).replace(/^\//, '') : '';
  const activeSlug = resolveActiveTab(rest);

  return (
    <div className="border-b bg-card">
      <nav aria-label="Sekce akce" className="flex flex-wrap gap-1 px-4 py-2">
        {EVENT_TABS.map((tab) => {
          const href = tab.slug ? `${base}/${tab.slug}` : base;
          const active = tab.slug === activeSlug;
          return (
            <Link
              key={tab.slug || 'prehled'}
              href={href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                active
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

/**
 * Ke které záložce patří aktuální cesta.
 *
 * Zvládá tři případy:
 *   ''                → Přehled
 *   'ceny'            → rozcestník záložky
 *   'dynamic-pricing' → konkrétní funkce, dohledá se její záložka
 */
function resolveActiveTab(rest: string): EventTab['slug'] {
  if (!rest) return '';
  const first = rest.split('/')[0];

  const asTab = EVENT_TABS.find((t) => t.slug === first);
  if (asTab) return asTab.slug;

  const feature = EVENT_FEATURES.find((f) => f.slug === first);
  return feature ? feature.tab : '';
}
