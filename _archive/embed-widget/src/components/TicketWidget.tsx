'use client';

import { useEffect, useState, useCallback } from 'react';
import type { WidgetEvent, WidgetTicketType } from '../types/widget.types';
import { sendToParent } from '../lib/postmessage';
import { formatWidgetPrice } from '../lib/format';

interface Props {
  event: WidgetEvent;
  color?: string;   // primary color z data-tixly-color
}

interface Selection {
  ticketTypeId: string;
  quantity: number;
}

// ---------------------------------------------------------------------------
// TicketWidget — renderuje se uvnitř iframe na tixly.cz/widget/[eventId]
// ---------------------------------------------------------------------------
export function TicketWidget({ event, color = '#2563eb' }: Props) {
  const [selection, setSelection] = useState<Selection | null>(null);

  // Informuj rodiče o výšce po každém renderu
  const reportHeight = useCallback(() => {
    const height = document.documentElement.scrollHeight;
    sendToParent({ type: 'TIXLY_RESIZE', height });
  }, []);

  useEffect(() => {
    reportHeight();
    sendToParent({ type: 'TIXLY_READY' });
  }, [reportHeight]);

  useEffect(() => {
    window.addEventListener('resize', reportHeight);
    return () => window.removeEventListener('resize', reportHeight);
  }, [reportHeight]);

  function handleSelect(tt: WidgetTicketType) {
    if (tt.phase === 'sold_out') return;
    setSelection((prev) =>
      prev?.ticketTypeId === tt.id
        ? null
        : { ticketTypeId: tt.id, quantity: 1 },
    );
  }

  function handleQuantity(delta: number) {
    if (!selection) return;
    const tt = event.ticketTypes.find((t) => t.id === selection.ticketTypeId);
    if (!tt) return;
    const next = Math.max(1, Math.min(tt.maxPerOrder, selection.quantity + delta));
    setSelection({ ...selection, quantity: next });
  }

  function handleCheckout() {
    if (!selection) return;
    const tt = event.ticketTypes.find((t) => t.id === selection.ticketTypeId);
    if (!tt) return;

    sendToParent({ type: 'TIXLY_CHECKOUT_STARTED', eventId: event.checkoutUrl });

    const url = new URL(event.checkoutUrl);
    url.searchParams.set('ticket_type', selection.ticketTypeId);
    url.searchParams.set('qty', String(selection.quantity));

    window.open(url.toString(), '_blank', 'noopener,noreferrer');
  }

  const selectedTt = selection
    ? event.ticketTypes.find((t) => t.id === selection.ticketTypeId)
    : null;

  const totalPrice = selectedTt ? selectedTt.price * selection!.quantity : 0;

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', padding: '16px', maxWidth: '480px', margin: '0 auto' }}>
      {/* Hlavička akce */}
      <div style={{ marginBottom: '16px' }}>
        <h2 style={{ margin: '0 0 4px', fontSize: '18px', fontWeight: 700 }}>{event.name}</h2>
        <p style={{ margin: 0, fontSize: '14px', color: '#6b7280' }}>
          {new Intl.DateTimeFormat(event.locale, {
            dateStyle: 'long',
            timeStyle: 'short',
          }).format(new Date(event.date))}{' '}
          · {event.venueName}, {event.city}
        </p>
      </div>

      {/* Typy vstupenek */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '16px' }}>
        {event.ticketTypes.map((tt) => {
          const isSelected = selection?.ticketTypeId === tt.id;
          const isSoldOut = tt.phase === 'sold_out' || tt.available === 0;

          return (
            <button
              key={tt.id}
              onClick={() => handleSelect(tt)}
              disabled={isSoldOut}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '12px 16px',
                border: `2px solid ${isSelected ? color : '#e5e7eb'}`,
                borderRadius: '8px',
                background: isSelected ? `${color}10` : '#fff',
                cursor: isSoldOut ? 'not-allowed' : 'pointer',
                opacity: isSoldOut ? 0.5 : 1,
                textAlign: 'left',
                width: '100%',
              }}
            >
              <div>
                <div style={{ fontWeight: 600, fontSize: '15px' }}>{tt.name}</div>
                <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '2px' }}>
                  {isSoldOut
                    ? 'Vyprodáno'
                    : `Zbývá ${tt.available} vstupenek`}
                </div>
              </div>
              <div style={{ fontWeight: 700, fontSize: '16px', color: isSoldOut ? '#9ca3af' : '#111' }}>
                {formatWidgetPrice(tt.price, event.currency, event.locale)}
              </div>
            </button>
          );
        })}
      </div>

      {/* Výběr množství + checkout */}
      {selection && selectedTt && (
        <div
          style={{
            borderTop: '1px solid #e5e7eb',
            paddingTop: '16px',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
          }}
        >
          {/* Počet */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span style={{ fontSize: '14px', color: '#374151' }}>Počet:</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <button
                onClick={() => handleQuantity(-1)}
                style={quantityBtnStyle}
                aria-label="Méně"
              >−</button>
              <span style={{ minWidth: '24px', textAlign: 'center', fontWeight: 600 }}>
                {selection.quantity}
              </span>
              <button
                onClick={() => handleQuantity(1)}
                disabled={selection.quantity >= selectedTt.maxPerOrder}
                style={{ ...quantityBtnStyle, opacity: selection.quantity >= selectedTt.maxPerOrder ? 0.4 : 1 }}
                aria-label="Více"
              >+</button>
            </div>
            <span style={{ fontSize: '12px', color: '#9ca3af' }}>
              max {selectedTt.maxPerOrder} ks
            </span>
          </div>

          {/* Tlačítko koupit */}
          <button
            onClick={handleCheckout}
            style={{
              background: color,
              color: '#fff',
              border: 'none',
              borderRadius: '8px',
              padding: '14px 20px',
              fontSize: '16px',
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              width: '100%',
            }}
          >
            <span>Koupit vstupenky</span>
            <span>{formatWidgetPrice(totalPrice, event.currency, event.locale)}</span>
          </button>

          <p style={{ margin: 0, fontSize: '11px', color: '#9ca3af', textAlign: 'center' }}>
            Dokončení objednávky na{' '}
            <a href="https://tixly.cz" target="_blank" rel="noopener noreferrer" style={{ color: '#9ca3af' }}>
              tixly.cz
            </a>
          </p>
        </div>
      )}
    </div>
  );
}

const quantityBtnStyle: React.CSSProperties = {
  width: '28px',
  height: '28px',
  borderRadius: '50%',
  border: '1px solid #d1d5db',
  background: '#f9fafb',
  cursor: 'pointer',
  fontSize: '16px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  lineHeight: 1,
  padding: 0,
};
