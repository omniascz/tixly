import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  createTikTokShopAdapter,
  createGoogleThingsToDoAdapter,
  createInstagramShoppingAdapter,
  isSocialChannel,
} from '../services/social-channel-adapters';

// ─── Mock HTTP client ─────────────────────────────────────────

const mockHttp = {
  post: vi.fn(),
  put: vi.fn(),
  get: vi.fn(),
};

beforeEach(() => vi.resetAllMocks());

const meta = {
  eventId: 'event-1',
  eventName: 'Rock Festival 2026',
  eventDescription: 'Největší rockový festival roku',
  eventUrl: 'https://tixly.cz/events/event-1',
  eventImageUrl: 'https://cdn.tixly.cz/rock-fest.jpg',
  eventDate: '2026-07-15',
  venue: 'O2 Arena Praha',
  ticketTypeId: 'general-admission',
};

// ─── TikTok Shop ─────────────────────────────────────────────

describe('TikTok Shop adapter', () => {
  const config = {
    appKey: 'app-key',
    appSecret: 'app-secret',
    shopId: 'shop-123',
    accessToken: 'access-token',
    apiBase: 'https://mock-tiktok.test',
  };

  it('pushAvailability creates new product when no externalEventId', async () => {
    mockHttp.post.mockResolvedValueOnce({ data: { product_id: 'tt-product-42' }, code: 0 });

    const adapter = createTikTokShopAdapter(config, mockHttp);
    const result = await adapter.pushAvailability(null, 100, 89900, meta);

    expect(result.externalEventId).toBe('tt-product-42');
    expect(mockHttp.post).toHaveBeenCalledWith(
      expect.stringContaining('/api/products'),
      expect.objectContaining({ product_name: 'Rock Festival 2026' }),
      expect.objectContaining({ 'x-tts-access-token': 'access-token' }),
    );
  });

  it('pushAvailability updates existing product when externalEventId provided', async () => {
    mockHttp.put.mockResolvedValueOnce({ data: { product_id: 'tt-product-42' }, code: 0 });

    const adapter = createTikTokShopAdapter(config, mockHttp);
    const result = await adapter.pushAvailability('tt-product-42', 80, 89900, meta);

    expect(result.externalEventId).toBe('tt-product-42');
    expect(mockHttp.put).toHaveBeenCalled();
    expect(mockHttp.post).not.toHaveBeenCalled();
  });

  it('pullSoldQty sums quantities across completed orders', async () => {
    mockHttp.get.mockResolvedValueOnce({
      data: {
        order_list: [
          { item_list: [{ quantity: 2 }] },
          { item_list: [{ quantity: 3 }] },
        ],
        total_count: 2,
      },
    });

    const adapter = createTikTokShopAdapter(config, mockHttp);
    const sold = await adapter.pullSoldQty('tt-product-42');

    expect(sold).toBe(5);
  });

  it('pushAvailability converts halire to CZK decimal', async () => {
    mockHttp.post.mockResolvedValueOnce({ data: { product_id: 'tt-new' }, code: 0 });

    const adapter = createTikTokShopAdapter(config, mockHttp);
    await adapter.pushAvailability(null, 50, 129900, meta); // 1299 Kč

    const body = mockHttp.post.mock.calls[0][1];
    expect(body.skus[0].original_price).toBe('1299.00');
  });
});

// ─── Google Things to Do ──────────────────────────────────────

describe('Google Things to Do adapter', () => {
  const config = {
    merchantId: 'merchant-999',
    serviceAccountToken: 'sa-token',
    apiBase: 'https://mock-gttd.test',
  };

  it('pushAvailability inserts product feed into Merchant Center', async () => {
    mockHttp.post.mockResolvedValueOnce({ name: 'products/tixly-event-1', offerId: 'tixly-event-1' });

    const adapter = createGoogleThingsToDoAdapter(config, mockHttp);
    const result = await adapter.pushAvailability(null, 200, 59900, meta);

    expect(result.externalEventId).toBe('tixly-event-1');
    const body = mockHttp.post.mock.calls[0][1];
    expect(body.products[0]).toMatchObject({
      contentLanguage: 'cs',
      targetCountry: 'CZ',
      availability: 'in stock',
    });
  });

  it('sets availability to "out of stock" when qty is 0', async () => {
    mockHttp.post.mockResolvedValueOnce({ offerId: 'tixly-event-1' });

    const adapter = createGoogleThingsToDoAdapter(config, mockHttp);
    await adapter.pushAvailability('tixly-event-1', 0, 59900, meta);

    const body = mockHttp.post.mock.calls[0][1];
    expect(body.products[0].availability).toBe('out of stock');
  });

  it('pullSoldQty reads conversions from Merchant Center report', async () => {
    mockHttp.post.mockResolvedValueOnce({
      rows: [{ metrics: { clicks: 150, conversions: 42 } }],
    });

    const adapter = createGoogleThingsToDoAdapter(config, mockHttp);
    const sold = await adapter.pullSoldQty('tixly-event-1');

    expect(sold).toBe(42);
  });

  it('pullSoldQty returns 0 when no rows in report', async () => {
    mockHttp.post.mockResolvedValueOnce({ rows: [] });

    const adapter = createGoogleThingsToDoAdapter(config, mockHttp);
    const sold = await adapter.pullSoldQty('tixly-event-1');

    expect(sold).toBe(0);
  });
});

// ─── Instagram Shopping ───────────────────────────────────────

describe('Instagram Shopping adapter', () => {
  const config = {
    catalogId: 'catalog-777',
    accessToken: 'ig-access-token',
    apiBase: 'https://mock-fb.test/v19.0',
  };

  it('pushAvailability creates catalog product for new event', async () => {
    mockHttp.post.mockResolvedValueOnce({ id: 'fb-product-99' });

    const adapter = createInstagramShoppingAdapter(config, mockHttp);
    const result = await adapter.pushAvailability(null, 150, 79900, meta);

    expect(result.externalEventId).toBe('fb-product-99');
    expect(mockHttp.post).toHaveBeenCalledWith(
      expect.stringContaining('catalog-777/products'),
      expect.objectContaining({
        name: 'Rock Festival 2026',
        availability: 'in stock',
      }),
      expect.any(Object),
    );
  });

  it('pushAvailability updates existing product', async () => {
    mockHttp.post.mockResolvedValueOnce({ id: 'fb-product-99' });

    const adapter = createInstagramShoppingAdapter(config, mockHttp);
    const result = await adapter.pushAvailability('fb-product-99', 100, 79900, meta);

    expect(result.externalEventId).toBe('fb-product-99');
    // Should POST to existing product ID, not catalog
    expect(mockHttp.post.mock.calls[0][0]).toContain('fb-product-99');
  });

  it('pullSoldQty counts orders from Facebook Commerce', async () => {
    mockHttp.get.mockResolvedValueOnce({
      data: [
        { channel: 'instagram', buyer_details: {}, selected_item: { quantity: 2 } },
        { channel: 'facebook', buyer_details: {}, selected_item: { quantity: 1 } },
      ],
    });

    const adapter = createInstagramShoppingAdapter(config, mockHttp);
    const sold = await adapter.pullSoldQty('fb-product-99');

    expect(sold).toBe(3);
  });

  it('includes access_token in all requests as query param', async () => {
    mockHttp.post.mockResolvedValueOnce({ id: 'fb-product-x' });

    const adapter = createInstagramShoppingAdapter(config, mockHttp);
    await adapter.pushAvailability(null, 50, 59900, meta);

    const url = mockHttp.post.mock.calls[0][0] as string;
    expect(url).toContain('access_token=ig-access-token');
  });
});

// ─── isSocialChannel ─────────────────────────────────────────

describe('isSocialChannel', () => {
  it('identifies social channel IDs', () => {
    expect(isSocialChannel('tiktok_shop')).toBe(true);
    expect(isSocialChannel('google_things_to_do')).toBe(true);
    expect(isSocialChannel('instagram_shopping')).toBe(true);
  });

  it('rejects non-social channel IDs', () => {
    expect(isSocialChannel('goout')).toBe(false);
    expect(isSocialChannel('smsticket')).toBe(false);
    expect(isSocialChannel('unknown')).toBe(false);
  });
});
