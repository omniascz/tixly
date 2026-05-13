import { describe, it, expect, vi } from 'vitest';
import {
  createFeedSubscription,
  validateApiKey,
  getFeedPage,
  generateCsv,
} from '../services/discovery-feed.service.js';
import type { DbAdapter, FeedEvent } from '../services/discovery-feed.service.js';

function makeSubscriptionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sub-001',
    partner_name: 'GoOut.net',
    contact_email: 'api@goout.net',
    api_key: 'abc123def456ghi789',
    allowed_promoters: null,
    status: 'active',
    rate_limit_per_hour: 1000,
    created_at: '2026-04-14T10:00:00Z',
    last_used_at: null,
    ...overrides,
  };
}

function makeEventRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'event-001',
    name: 'Letní Slavnosti 2026',
    slug: 'letni-slavnosti-2026',
    description: 'Největší letní festival',
    short_description: 'Festival hudby a zábavy',
    date_start: '2026-07-15T18:00:00Z',
    date_end: '2026-07-15T23:00:00Z',
    doors_open: '2026-07-15T17:00:00Z',
    timezone: 'Europe/Prague',
    status: 'published',
    is_public: true,
    is_featured: true,
    venue_id: 'venue-001',
    venue_name: 'O2 Arena',
    venue_address: 'Ocelářská 2',
    venue_city: 'Praha',
    venue_region: 'Hlavní město Praha',
    venue_country: 'CZ',
    venue_postal_code: '190 00',
    venue_lat: '50.1000',
    venue_lng: '14.4500',
    venue_capacity: 20000,
    promoter_id: 'promoter-001',
    promoter_name: 'Live Nation CZ',
    category: 'festival',
    subcategory: 'hudba',
    tags: ['festival', 'léto', 'Praha'],
    age_restriction: null,
    min_price_hellers: 99000,
    max_price_hellers: 299000,
    currency: 'CZK',
    ticket_types_count: 3,
    total_capacity: 10000,
    total_sold: 7500,
    available_count: 2500,
    is_sold_out: false,
    sale_start_at: '2026-01-15T10:00:00Z',
    sale_end_at: '2026-07-15T16:00:00Z',
    cover_image_url: 'https://cdn.example.com/events/letni-slavnosti.jpg',
    thumbnail_url: 'https://cdn.example.com/events/letni-slavnosti-thumb.jpg',
    seo_title: 'Letní Slavnosti 2026 — Vstupenky',
    seo_description: 'Kupte vstupenky na Letní Slavnosti 2026',
    canonical_url: 'https://tixly.cz/events/letni-slavnosti-2026',
    created_at: '2026-01-01T10:00:00Z',
    updated_at: '2026-04-14T10:00:00Z',
    published_at: '2026-01-15T10:00:00Z',
    ...overrides,
  };
}

function makeDb(queryResults: unknown[][] = [], executeMock = vi.fn()): DbAdapter {
  let callIdx = 0;
  return {
    query: vi.fn(async () => {
      const result = queryResults[callIdx] ?? [];
      callIdx++;
      return result;
    }),
    execute: executeMock,
  };
}

describe('createFeedSubscription', () => {
  it('vytvoří API klíč pro partnera', async () => {
    const db = makeDb([[makeSubscriptionRow()]]);

    const result = await createFeedSubscription('GoOut.net', 'api@goout.net', null, db);

    expect(result.partnerName).toBe('GoOut.net');
    expect(result.apiKey).toBeTruthy();
    expect(result.status).toBe('active');
    expect(result.allowedPromoters).toBeNull();
  });

  it('vyhodí VALIDATION_ERROR pro prázdný název partnera', async () => {
    const db = makeDb([]);

    await expect(createFeedSubscription('', 'api@goout.net', null, db))
      .rejects.toThrow('VALIDATION_ERROR');
  });

  it('vyhodí VALIDATION_ERROR pro neplatný email', async () => {
    const db = makeDb([]);

    await expect(createFeedSubscription('GoOut', 'not-an-email', null, db))
      .rejects.toThrow('VALIDATION_ERROR');
  });
});

describe('validateApiKey', () => {
  it('vrátí subscripci pro platný API klíč', async () => {
    const db = makeDb([[makeSubscriptionRow({ last_used_at: '2026-04-14T11:00:00Z' })]]);

    const result = await validateApiKey('abc123def456ghi789', db);

    expect(result).not.toBeNull();
    expect(result?.partnerName).toBe('GoOut.net');
  });

  it('vrátí null pro neplatný API klíč', async () => {
    const db = makeDb([[]]); // empty

    const result = await validateApiKey('invalid-key', db);

    expect(result).toBeNull();
  });
});

describe('getFeedPage', () => {
  it('vrátí stránku veřejných akcí', async () => {
    const db = makeDb([
      [{ total: '25' }],       // count query
      [makeEventRow(), makeEventRow({ id: 'event-002', name: 'Rock Night 2026' })],  // data query
    ]);

    const result = await getFeedPage(1, 10, {}, db);

    expect(result.total).toBe(25);
    expect(result.events).toHaveLength(2);
    expect(result.hasMore).toBe(true);
    expect(result.page).toBe(1);
  });

  it('obsahuje všechna povinná pole pro každou akci', async () => {
    const db = makeDb([
      [{ total: '1' }],
      [makeEventRow()],
    ]);

    const result = await getFeedPage(1, 10, {}, db);
    const event = result.events[0];

    expect(event.id).toBeTruthy();
    expect(event.name).toBe('Letní Slavnosti 2026');
    expect(event.venueName).toBe('O2 Arena');
    expect(event.venueCity).toBe('Praha');
    expect(event.minPriceHellers).toBe(99000);
    expect(event.maxPriceHellers).toBe(299000);
    expect(event.isSoldOut).toBe(false);
    expect(event.venueLat).toBe(50.1);
    expect(event.tags).toContain('festival');
  });

  it('filtruje podle města', async () => {
    const db = makeDb([
      [{ total: '5' }],
      [makeEventRow()],
    ]);

    const result = await getFeedPage(1, 10, { city: 'Praha' }, db);

    // Verify the query was called (city filter applied)
    expect(db.query).toHaveBeenCalledTimes(2);
    expect(result.events).toHaveLength(1);
  });

  it('omezuje pageSize na maximum 100', async () => {
    const db = makeDb([
      [{ total: '0' }],
      [],
    ]);

    const result = await getFeedPage(1, 9999, {}, db);

    expect(result.pageSize).toBe(100);
  });
});

describe('generateCsv', () => {
  const sampleEvent: FeedEvent = {
    id: 'event-001',
    name: 'Letní Slavnosti, 2026',
    slug: null,
    description: null,
    shortDescription: null,
    dateStart: '2026-07-15T18:00:00Z',
    dateEnd: null,
    doorsOpen: null,
    timezone: 'Europe/Prague',
    status: 'published',
    isPublic: true,
    isFeatured: true,
    venueId: null,
    venueName: null,
    venueAddress: null,
    venueCity: 'Praha',
    venueRegion: null,
    venueCountry: 'CZ',
    venuePostalCode: null,
    venueLat: null,
    venueLng: null,
    venueCapacity: null,
    promoterId: 'promoter-001',
    promoterName: null,
    category: 'festival',
    subcategory: null,
    tags: [],
    ageRestriction: null,
    minPriceHellers: 99000,
    maxPriceHellers: 299000,
    currency: 'CZK',
    ticketTypesCount: 2,
    totalCapacity: 10000,
    totalSold: 5000,
    availableCount: 5000,
    isSoldOut: false,
    saleStartAt: null,
    saleEndAt: null,
    coverImageUrl: null,
    thumbnailUrl: null,
    seoTitle: null,
    seoDescription: null,
    canonicalUrl: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-04-14T00:00:00Z',
    publishedAt: null,
  };

  it('generuje CSV s hlavičkou a řádkem dat', () => {
    const csv = generateCsv([sampleEvent]);
    const lines = csv.split('\n');

    expect(lines[0]).toContain('id');
    expect(lines[0]).toContain('name');
    expect(lines[0]).toContain('dateStart');
    expect(lines).toHaveLength(2); // header + 1 event
  });

  it('správně escapuje čárky v názvech', () => {
    const csv = generateCsv([sampleEvent]);
    // Name contains comma, should be quoted
    expect(csv).toContain('"Letní Slavnosti, 2026"');
  });

  it('generuje prázdný CSV pro prázdný seznam', () => {
    const csv = generateCsv([]);
    expect(csv.split('\n')).toHaveLength(1); // only header
  });
});
