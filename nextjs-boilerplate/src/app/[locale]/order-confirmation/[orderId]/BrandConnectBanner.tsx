'use client';

import { useEffect, useState } from 'react';
import { ExternalLink } from 'lucide-react';

interface Partner {
  partnership_id: string;
  event_id: string;
  campaign_name: string;
  tagline: string | null;
  logo_url: string | null;
  cta_text: string | null;
  cta_url: string | null;
  advertiser_name: string;
}

export function BrandConnectBanner({ eventId }: { eventId: string }) {
  const [partners, setPartners] = useState<Partner[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/brand-connect/event/${eventId}`)
      .then((r) => r.json() as Promise<{ partners: Partner[] }>)
      .then(({ partners: p }) => {
        if (cancelled) return;
        setPartners(p ?? []);
        // track impression for each active partnership
        p?.forEach((partner) => {
          void fetch('/api/brand-connect/track', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ partnership_id: partner.partnership_id, event_id: eventId, kind: 'impression' }),
          });
        });
      })
      .catch(() => {/* silent */});
    return () => { cancelled = true; };
  }, [eventId]);

  if (partners.length === 0) return null;

  return (
    <div className="space-y-2">
      {partners.map((p) => (
        <div
          key={p.partnership_id}
          className="flex items-center gap-3 rounded-lg border border-dashed border-border/60 bg-muted/20 p-3"
        >
          {p.logo_url && (
            <img
              src={p.logo_url}
              alt={p.advertiser_name}
              className="h-10 w-10 flex-shrink-0 rounded object-contain"
            />
          )}
          <div className="flex-1 min-w-0">
            <p className="text-xs text-muted-foreground">Partnerský obsah</p>
            <p className="text-sm font-medium leading-snug">
              {p.tagline ?? p.campaign_name}
            </p>
            {p.advertiser_name && (
              <p className="text-xs text-muted-foreground">{p.advertiser_name}</p>
            )}
          </div>
          {p.cta_url && (
            <a
              href={p.cta_url}
              target="_blank"
              rel="noopener noreferrer sponsored"
              onClick={() => {
                void fetch('/api/brand-connect/track', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ partnership_id: p.partnership_id, event_id: eventId, kind: 'click' }),
                });
              }}
              className="flex-shrink-0 flex items-center gap-1 rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-secondary"
            >
              {p.cta_text ?? 'Zjistit více'}
              <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
      ))}
    </div>
  );
}
