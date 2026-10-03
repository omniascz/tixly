'use client';

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import Link from 'next/link';
import { PageHeader } from '@/components/admin/PageHeader';
import {
  EVENT_TABS,
  featuresForTab,
  type EventFeature,
  type EventTabSlug,
} from '@/lib/admin/nav';

/**
 * Obsah jedné záložky akce.
 *
 * Nahrazuje původní stav, kdy bylo 74 odkazů naskládaných do devíti
 * rozbalovacích menu v jedné liště. Funkce jsou tu seskupené do sekcí
 * a ty méně obvyklé jsou pod jedním rozbalením, ne v hlavním výpisu.
 *
 * Pozn.: filtrování podle šablony akce (tier 'template') zatím neběží —
 * API akce dnes šablonu nevrací. Do té doby se funkce vázané na šablonu
 * zobrazují mezi hlavními; přepnutí je pak na jednom místě v isFeatureEnabled().
 */
export function SectionHub({ eventId, tab }: { eventId: string; tab: EventTabSlug }) {
  const [showOptional, setShowOptional] = useState(false);
  const meta = EVENT_TABS.find((t) => t.slug === tab);
  const groups = featuresForTab(tab);

  const primary = groups
    .map((g) => ({ ...g, items: g.items.filter((i) => i.tier !== 'optional') }))
    .filter((g) => g.items.length > 0);

  const optional = groups.flatMap((g) => g.items.filter((i) => i.tier === 'optional'));

  return (
    <div>
      <PageHeader title={meta?.label ?? 'Akce'} description={meta?.description} />

      {primary.map((group) => (
        <section key={group.section} className="mb-8">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {group.section}
          </h3>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
            {group.items.map((f) => (
              <FeatureCard key={f.slug} eventId={eventId} feature={f} />
            ))}
          </div>
        </section>
      ))}

      {optional.length > 0 ? (
        <section className="mt-2">
          <button
            type="button"
            onClick={() => setShowOptional((v) => !v)}
            aria-expanded={showOptional}
            className="flex w-full items-center gap-2 rounded-lg border bg-card px-4 py-3 text-left text-sm font-medium hover:bg-muted/40"
          >
            <ChevronDown
              className={`h-4 w-4 text-muted-foreground transition-transform ${
                showOptional ? 'rotate-180' : ''
              }`}
              aria-hidden
            />
            Další funkce ({optional.length})
            <span className="ml-auto text-xs font-normal text-muted-foreground">
              Volitelné nástroje, které většina akcí nepotřebuje
            </span>
          </button>

          {showOptional ? (
            <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
              {optional.map((f) => (
                <FeatureCard key={f.slug} eventId={eventId} feature={f} muted />
              ))}
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

function FeatureCard({
  eventId,
  feature,
  muted = false,
}: {
  eventId: string;
  feature: EventFeature;
  muted?: boolean;
}) {
  return (
    <Link
      href={`/admin/events/${eventId}/${feature.slug}`}
      className={`block rounded-lg border bg-card p-4 transition-colors hover:border-primary/40 hover:bg-muted/30 ${
        muted ? 'opacity-90' : ''
      }`}
    >
      <div className="font-medium">{feature.label}</div>
      <p className="mt-1 text-sm text-muted-foreground">{feature.hint}</p>
    </Link>
  );
}
