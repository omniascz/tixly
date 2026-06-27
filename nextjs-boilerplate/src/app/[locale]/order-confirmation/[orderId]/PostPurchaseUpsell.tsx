'use client';

/**
 * PostPurchaseUpsell — zobrazí se na stránce potvrzení objednávky
 *
 * Načte dostupné add-ony a cestovní partnerské odkazy pro danou akci.
 * Motivace: 58 % fanoušků kupuje add-ony, průměrný extra výdaj $300.
 */

import { useEffect, useState } from 'react';
import { ExternalLink } from 'lucide-react';

interface Addon {
  id: string;
  name: string;
  description: string | null;
  category: string;
  price_halire: number;
  image_url: string | null;
}

interface TravelLink {
  id: string;
  label: string;
  category: string;
  partner_name: string | null;
  url: string;
  affiliate_note: string | null;
}

interface Sponsor {
  id: string;
  name: string;
  logo_url: string | null;
  click_url: string | null;
  tagline: string | null;
  placement: string;
}

const ADDON_CATEGORY_ICON: Record<string, string> = {
  merch: '👕',
  parking: '🅿️',
  transport: '🚆',
  camping: '⛺',
  accommodation: '🏨',
  food: '🍕',
  insurance: '🛡️',
  upgrade: '⬆️',
  other: '🎁',
};

const TRAVEL_CATEGORY_ICON: Record<string, string> = {
  hotel: '🏨',
  transport: '🚆',
  parking: '🅿️',
  rideshare: '🚗',
  other: '🔗',
};

function fmt(halire: number, currency: string): string {
  return `${(halire / 100).toLocaleString('cs-CZ')} ${currency}`;
}

export function PostPurchaseUpsell({
  eventId,
  eventUrl,
  purchasedAddonNames,
  currency,
}: {
  eventId: string;
  eventUrl: string;
  purchasedAddonNames: string[];
  currency: string;
}) {
  const [addons, setAddons] = useState<Addon[]>([]);
  const [travelLinks, setTravelLinks] = useState<TravelLink[]>([]);
  const [sponsors, setSponsors] = useState<Sponsor[]>([]);

  useEffect(() => {
    void Promise.all([
      fetch(`/api/events/${eventId}/addons`)
        .then((r) => r.ok ? r.json() : { addons: [] })
        .then((d: { addons?: Addon[] }) => {
          const available = (d.addons ?? []).filter(
            (a) => !purchasedAddonNames.includes(a.name),
          );
          setAddons(available.slice(0, 6));
        }),
      fetch(`/api/events/${eventId}/travel-links`)
        .then((r) => r.ok ? r.json() : { links: [] })
        .then((d: { links?: TravelLink[] }) => setTravelLinks(d.links ?? [])),
      fetch(`/api/events/${eventId}/sponsors`)
        .then((r) => r.ok ? r.json() : { sponsors: [] })
        .then((d: { sponsors?: Sponsor[] }) => {
          const visible = (d.sponsors ?? []).filter(
            (s) => s.placement === 'all' || s.placement === 'confirmation',
          );
          setSponsors(visible);
        }),
    ]);
  }, [eventId, purchasedAddonNames]);

  const hasContent = addons.length > 0 || travelLinks.length > 0 || sponsors.length > 0;
  if (!hasContent) return null;

  return (
    <div className="space-y-5 border-t pt-5">

      {/* Add-ons */}
      {addons.length > 0 && (
        <div>
          <h3 className="mb-3 text-sm font-semibold">Doplňte svůj zážitek</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            {addons.map((addon) => (
              <a
                key={addon.id}
                href={eventUrl}
                className="group flex items-start gap-3 rounded-lg border bg-muted/30 p-3 transition hover:border-primary hover:bg-primary/5"
              >
                <span className="text-xl leading-none">
                  {ADDON_CATEGORY_ICON[addon.category] ?? '🎁'}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="truncate text-sm font-medium group-hover:text-primary">
                    {addon.name}
                  </div>
                  {addon.description && (
                    <div className="mt-0.5 truncate text-xs text-muted-foreground">
                      {addon.description}
                    </div>
                  )}
                  <div className="mt-1 text-xs font-semibold text-primary">
                    {fmt(addon.price_halire, currency)}
                  </div>
                </div>
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Travel links */}
      {travelLinks.length > 0 && (
        <div>
          <h3 className="mb-3 text-sm font-semibold">Plánujte cestu</h3>
          <div className="divide-y rounded-lg border">
            {travelLinks.map((link) => (
              <a
                key={link.id}
                href={link.url}
                target="_blank"
                rel="noreferrer noopener"
                className="group flex items-center gap-3 p-3 transition hover:bg-muted/50"
              >
                <span className="text-lg">{TRAVEL_CATEGORY_ICON[link.category] ?? '🔗'}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium group-hover:text-primary truncate">
                    {link.label}
                  </div>
                  {link.partner_name && (
                    <div className="text-xs text-muted-foreground">{link.partner_name}</div>
                  )}
                  {link.affiliate_note && (
                    <div className="text-xs text-muted-foreground italic">{link.affiliate_note}</div>
                  )}
                </div>
                <ExternalLink className="h-4 w-4 flex-shrink-0 text-muted-foreground group-hover:text-primary" />
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Sponsors */}
      {sponsors.length > 0 && (
        <div>
          <p className="mb-2 text-xs uppercase text-muted-foreground tracking-wide">Partneři akce</p>
          <div className="flex flex-wrap gap-3">
            {sponsors.map((s) => {
              const inner = (
                <>
                  {s.logo_url ? (
                    <img
                      src={s.logo_url}
                      alt={s.name}
                      className="h-8 max-w-[100px] object-contain"
                    />
                  ) : (
                    <span className="text-xs font-medium text-muted-foreground">{s.name}</span>
                  )}
                  {s.tagline && (
                    <span className="text-xs text-muted-foreground">{s.tagline}</span>
                  )}
                </>
              );
              return s.click_url ? (
                <a
                  key={s.id}
                  href={s.click_url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="flex items-center gap-2 rounded-md border bg-background px-3 py-2 hover:border-primary"
                  title={s.name}
                >
                  {inner}
                </a>
              ) : (
                <div
                  key={s.id}
                  className="flex items-center gap-2 rounded-md border bg-background px-3 py-2"
                  title={s.name}
                >
                  {inner}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
