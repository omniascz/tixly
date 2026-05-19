'use client';

import { useEffect } from 'react';

interface Promoter {
  id: string;
  slug: string;
  name: string;
  brand_color_hex: string | null;
  brand_logo_url: string | null;
}

interface EventItem {
  id: string;
  title: string;
  slug: string | null;
  date_start: string;
  city: string | null;
  venue_name: string | null;
  cover_image: string | null;
  min_price_halire: number | null;
  currency: string | null;
}

function formatPrice(halire: number | null, currency: string | null): string {
  if (halire === null || halire === undefined) return '';
  const kc = halire / 100;
  return `od ${kc.toLocaleString('cs-CZ', { maximumFractionDigits: 0 })} ${currency ?? 'Kč'}`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('cs-CZ', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function PromoterEmbedClient({
  promoter,
  events,
}: {
  promoter: Promoter;
  events: EventItem[];
}) {
  const brand = promoter.brand_color_hex && /^#[0-9a-f]{6}$/i.test(promoter.brand_color_hex)
    ? promoter.brand_color_hex
    : '#10b981';

  const appUrl = typeof window !== 'undefined' ? window.location.origin : '';

  useEffect(() => {
    const sendHeight = () => {
      const h = document.documentElement.scrollHeight;
      window.parent.postMessage({ type: 'tixly:resize', height: h }, '*');
    };
    sendHeight();
    const observer = new ResizeObserver(sendHeight);
    observer.observe(document.documentElement);
    return () => observer.disconnect();
  }, []);

  if (events.length === 0) {
    return (
      <div style={{ padding: '24px', fontSize: '14px', color: '#666', textAlign: 'center' }}>
        Žádné nadcházející akce.
      </div>
    );
  }

  return (
    <div style={{ padding: '12px', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          paddingBottom: '12px',
          borderBottom: `2px solid ${brand}`,
          marginBottom: '16px',
        }}
      >
        {promoter.brand_logo_url ? (
          <img
            src={promoter.brand_logo_url}
            alt=""
            style={{ width: '32px', height: '32px', objectFit: 'contain' }}
          />
        ) : null}
        <h2 style={{ margin: 0, fontSize: '18px', color: '#111' }}>{promoter.name}</h2>
      </header>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
          gap: '12px',
        }}
      >
        {events.map((ev) => {
          const href = `${appUrl}/cs/events/${ev.slug ?? ev.id}`;
          return (
            <a
              key={ev.id}
              href={href}
              target="_top"
              rel="noopener"
              style={{
                display: 'block',
                textDecoration: 'none',
                color: 'inherit',
                border: '1px solid #e5e5e5',
                borderRadius: '8px',
                overflow: 'hidden',
                background: '#fff',
                transition: 'transform 0.15s, box-shadow 0.15s',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'translateY(-2px)';
                e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.08)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'none';
                e.currentTarget.style.boxShadow = 'none';
              }}
            >
              {ev.cover_image ? (
                <div
                  style={{
                    aspectRatio: '16/9',
                    background: `url("${ev.cover_image}") center/cover`,
                  }}
                />
              ) : (
                <div style={{ aspectRatio: '16/9', background: '#f5f5f5' }} />
              )}
              <div style={{ padding: '10px 12px' }}>
                <div
                  style={{
                    fontSize: '11px',
                    color: '#888',
                    textTransform: 'uppercase',
                    letterSpacing: '0.4px',
                  }}
                >
                  {formatDate(ev.date_start)}
                </div>
                <div
                  style={{
                    fontSize: '14px',
                    fontWeight: 600,
                    marginTop: '4px',
                    color: '#111',
                    lineHeight: 1.3,
                    overflow: 'hidden',
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                  }}
                >
                  {ev.title}
                </div>
                {ev.venue_name ? (
                  <div style={{ fontSize: '12px', color: '#666', marginTop: '4px' }}>
                    {ev.venue_name}
                    {ev.city ? `, ${ev.city}` : ''}
                  </div>
                ) : null}
                <div
                  style={{
                    marginTop: '8px',
                    fontSize: '12px',
                    color: brand,
                    fontWeight: 500,
                  }}
                >
                  {formatPrice(ev.min_price_halire, ev.currency)}
                </div>
              </div>
            </a>
          );
        })}
      </div>

      <footer
        style={{
          marginTop: '16px',
          paddingTop: '12px',
          borderTop: '1px solid #eee',
          fontSize: '11px',
          color: '#999',
          textAlign: 'right',
        }}
      >
        Powered by{' '}
        <a href={appUrl} target="_top" style={{ color: '#999' }}>
          Tixly
        </a>
      </footer>
    </div>
  );
}
