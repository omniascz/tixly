import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { trackEvent } from '../lib/track-event.js';
import { META_EVENT_MAP, mapToMetaEvent } from '../lib/event-mapping.js';

describe('trackEvent', () => {
  const origWindow = globalThis.window;

  afterEach(() => {
    // Restore
    (globalThis as any).window = origWindow;
    vi.restoreAllMocks();
  });

  it('no-ops on server (no window)', () => {
    // @ts-expect-error — delete window for SSR simulation
    delete (globalThis as any).window;
    expect(() => trackEvent('page_view')).not.toThrow();
  });

  it('calls window.gtag when present', () => {
    const gtag = vi.fn();
    (globalThis as any).window = { gtag };
    trackEvent('purchase', { value: 1500, currency: 'CZK' });
    expect(gtag).toHaveBeenCalledWith('event', 'purchase', {
      value: 1500,
      currency: 'CZK',
    });
  });

  it('calls window.fbq with mapped Meta event name', () => {
    const fbq = vi.fn();
    (globalThis as any).window = { fbq };
    trackEvent('purchase', { value: 1500, currency: 'CZK' });
    expect(fbq).toHaveBeenCalled();
    const [method, name] = fbq.mock.calls[0]!;
    expect(method).toBe('track');
    expect(name).toBe('Purchase');
  });

  it('uses trackCustom for non-standard events', () => {
    const fbq = vi.fn();
    (globalThis as any).window = { fbq };
    trackEvent('custom_event_foo');
    const [method, name] = fbq.mock.calls[0]!;
    expect(method).toBe('trackCustom');
    expect(name).toBe('custom_event_foo');
  });

  it('maps add_to_cart → AddToCart', () => {
    const fbq = vi.fn();
    (globalThis as any).window = { fbq };
    trackEvent('add_to_cart', {
      items: [{ id: 'p1', name: 'Permanentka', price: 3000, quantity: 1 }],
    });
    const call = fbq.mock.calls[0]!;
    expect(call[1]).toBe('AddToCart');
    expect((call[2] as any).contents).toHaveLength(1);
    expect((call[2] as any).content_type).toBe('product');
  });

  it('does not throw when neither gtag nor fbq present', () => {
    (globalThis as any).window = {};
    expect(() => trackEvent('login')).not.toThrow();
  });
});

describe('META_EVENT_MAP', () => {
  it('covers all standard internal events', () => {
    const standards = [
      'page_view',
      'view_item',
      'add_to_cart',
      'begin_checkout',
      'purchase',
      'sign_up',
      'lead',
    ];
    for (const s of standards) {
      expect(META_EVENT_MAP[s]).toBeDefined();
    }
  });

  it('mapToMetaEvent recognizes standard events', () => {
    expect(mapToMetaEvent('purchase').isStandard).toBe(true);
    expect(mapToMetaEvent('view_item').metaName).toBe('ViewContent');
  });

  it('mapToMetaEvent falls back to custom for unknown', () => {
    const res = mapToMetaEvent('totally_unknown_event');
    expect(res.isStandard).toBe(false);
    expect(res.metaName).toBe('totally_unknown_event');
  });
});
