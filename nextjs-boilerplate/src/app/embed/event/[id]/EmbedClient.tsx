'use client';

import { useEffect, useState } from 'react';

interface TicketType {
  id: string;
  name: string;
  base_price: number;
  remaining_qty: number;
  currency: string;
}

interface Event {
  id: string;
  title: string;
  date_start: string;
  city: string | null;
  venue_name: string | null;
  cover_image: string | null;
  promoter_name: string;
  brand_color_hex: string | null;
}

export function EmbedClient({ event, variant }: { event: Event; variant: string }) {
  const [types, setTypes] = useState<TicketType[]>([]);
  const [appUrl] = useState(() => {
    if (typeof window === 'undefined') return '';
    return window.location.origin;
  });
  const brand = event.brand_color_hex && /^#[0-9a-f]{6}$/i.test(event.brand_color_hex)
    ? event.brand_color_hex
    : '#10b981';

  useEffect(() => {
    void load();
    async function load(): Promise<void> {
      try {
        const res = await fetch(`/api/events/${event.id}/ticket-types`);
        if (res.ok) {
          const j = (await res.json()) as { types?: TicketType[]; ticketTypes?: TicketType[] };
          setTypes(j.types ?? j.ticketTypes ?? []);
        }
      } catch {
        // ignore
      }
    }
  }, [event.id]);

  // Post height to parent for auto-resize
  useEffect(() => {
    function postHeight(): void {
      if (typeof window === 'undefined' || !window.parent) return;
      const height = document.documentElement.scrollHeight;
      window.parent.postMessage({ type: 'tixly:resize', height }, '*');
    }
    postHeight();
    const ro = new ResizeObserver(postHeight);
    ro.observe(document.body);
    return () => ro.disconnect();
  }, [types]);

  const checkoutUrl = `${appUrl}/cs/events/${event.id}`;

  if (variant === 'button') {
    return (
      <a
        href={checkoutUrl}
        target="_top"
        style={{
          display: 'inline-block',
          background: brand,
          color: 'white',
          padding: '12px 24px',
          borderRadius: 6,
          textDecoration: 'none',
          fontWeight: 600,
          fontSize: 14,
        }}
      >
        Koupit vstupenku → {event.title}
      </a>
    );
  }

  // Default: card variant
  return (
    <div
      style={{
        border: '1px solid #e5e7eb',
        borderRadius: 12,
        overflow: 'hidden',
        background: 'white',
        maxWidth: 480,
      }}
    >
      {event.cover_image ? (
        <div
          style={{
            aspectRatio: '16/9',
            backgroundImage: `url(${event.cover_image})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }}
        />
      ) : (
        <div
          style={{
            aspectRatio: '16/9',
            background: `linear-gradient(135deg, ${brand}, ${brand}88)`,
          }}
        />
      )}
      <div style={{ padding: 16 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>{event.title}</h2>
        <p style={{ margin: '4px 0 0', fontSize: 13, color: '#6b7280' }}>
          {new Date(event.date_start).toLocaleString('cs-CZ', {
            dateStyle: 'long',
            timeStyle: 'short',
          })}
          {event.venue_name ? ` · ${event.venue_name}` : ''}
          {event.city ? ` · ${event.city}` : ''}
        </p>

        {types.length > 0 ? (
          <div style={{ margin: '12px 0 0', fontSize: 13 }}>
            {types
              .filter((t) => t.remaining_qty > 0)
              .slice(0, 3)
              .map((t) => (
                <div
                  key={t.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    padding: '6px 0',
                    borderTop: '1px solid #f3f4f6',
                  }}
                >
                  <span>{t.name}</span>
                  <strong>
                    {(t.base_price / 100).toLocaleString('cs-CZ', { maximumFractionDigits: 0 })} Kč
                  </strong>
                </div>
              ))}
          </div>
        ) : null}

        <a
          href={checkoutUrl}
          target="_top"
          style={{
            display: 'block',
            background: brand,
            color: 'white',
            padding: '12px 16px',
            borderRadius: 6,
            textDecoration: 'none',
            fontWeight: 600,
            textAlign: 'center',
            marginTop: 12,
            fontSize: 14,
          }}
        >
          🎟 Koupit vstupenku
        </a>

        <p style={{ margin: '8px 0 0', fontSize: 11, color: '#9ca3af', textAlign: 'center' }}>
          Vstupenky na <a href={appUrl} target="_top" style={{ color: '#9ca3af' }}>Tixly</a>
        </p>
      </div>
    </div>
  );
}
