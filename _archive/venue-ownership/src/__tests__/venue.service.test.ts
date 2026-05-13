import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  listPublicVenues,
  getPublicVenue,
  createVenue,
  updateVenue,
  deleteVenue,
  makeVenuePublic,
  makeVenuePrivate,
  adminCreatePublicVenue,
  adminTransferVenue,
  listVenuesForPromoter,
  adminListVenues,
} from '../services/venue.service.js';
import { VenueError } from '../lib/venue-errors.js';
import type { DbAdapter, KafkaProducerAdapter, ServiceDeps } from '../lib/service-container.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PROMOTER_A = '11111111-1111-1111-1111-111111111111';
const PROMOTER_B = '22222222-2222-2222-2222-222222222222';
const ADMIN_ID   = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const VENUE_ID   = 'vvvvvvvv-vvvv-vvvv-vvvv-vvvvvvvvvvvv';

function makeVenueRow(overrides: Record<string, unknown> = {}) {
  return {
    id: VENUE_ID,
    name: 'Test Venue',
    slug: 'test-venue',
    address: 'Wenceslas Square 1',
    city: 'Prague',
    country: 'CZ',
    capacity: 500,
    timezone: 'Europe/Prague',
    description: null,
    image_urls: [],
    website: null,
    geo_lat: null,
    geo_lng: null,
    is_public: false,
    owner_promoter_id: PROMOTER_A,
    metadata: {},
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeDeps(
  queryResults: unknown[][] = [[]],
  executeResolves = true,
): ServiceDeps {
  let callIndex = 0;
  const db: DbAdapter = {
    query: vi.fn().mockImplementation(async () => {
      const result = queryResults[callIndex] ?? queryResults[queryResults.length - 1];
      callIndex++;
      return result;
    }),
    execute: executeResolves
      ? vi.fn().mockResolvedValue(undefined)
      : vi.fn().mockRejectedValue(new Error('DB error')),
    transaction: vi.fn().mockImplementation(async (fn) => fn(db)),
  };
  const kafka: KafkaProducerAdapter = {
    send: vi.fn().mockResolvedValue(undefined),
  };
  return { db, kafka };
}

// ---------------------------------------------------------------------------
// listPublicVenues
// ---------------------------------------------------------------------------
describe('listPublicVenues()', () => {
  it('returns only is_public = TRUE venues', async () => {
    const row = makeVenueRow({ is_public: true, owner_promoter_id: null });
    const deps = makeDeps([[{ count: '1' }], [row]]);
    const result = await listPublicVenues({}, {}, deps);
    expect(result.total).toBe(1);
    expect(result.items[0].isPublic).toBe(true);
    // SQL should contain is_public = TRUE — check query was called
    expect((deps.db.query as ReturnType<typeof vi.fn>).mock.calls[0][0]).toContain('is_public = TRUE');
  });

  it('filters by search term (name/city ILIKE)', async () => {
    const row = makeVenueRow({ is_public: true, name: 'Forum Karlín', city: 'Prague' });
    const deps = makeDeps([[{ count: '1' }], [row]]);
    const result = await listPublicVenues({ search: 'Forum' }, {}, deps);
    expect(result.items[0].name).toBe('Forum Karlín');
    // The SQL must include ILIKE
    const sql = (deps.db.query as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(sql).toContain('ILIKE');
  });

  it('filters by minCapacity', async () => {
    const deps = makeDeps([[{ count: '0' }], []]);
    const result = await listPublicVenues({ minCapacity: 1000 }, {}, deps);
    expect(result.total).toBe(0);
    expect(result.items).toHaveLength(0);
    const sql = (deps.db.query as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(sql).toContain('capacity >=');
  });

  it('applies pagination limit and offset', async () => {
    const deps = makeDeps([[{ count: '50' }], []]);
    await listPublicVenues({}, { limit: 5, offset: 10 }, deps);
    // params should include 5 and 10
    const params = (deps.db.query as ReturnType<typeof vi.fn>).mock.calls[1][1] as unknown[];
    expect(params).toContain(5);
    expect(params).toContain(10);
  });
});

// ---------------------------------------------------------------------------
// getPublicVenue
// ---------------------------------------------------------------------------
describe('getPublicVenue()', () => {
  it('returns venue when it exists and is public', async () => {
    const row = makeVenueRow({ is_public: true });
    const deps = makeDeps([[row]]);
    const venue = await getPublicVenue(VENUE_ID, deps);
    expect(venue.id).toBe(VENUE_ID);
    expect(venue.isPublic).toBe(true);
  });

  it('throws VENUE_NOT_FOUND when venue is private', async () => {
    const deps = makeDeps([[]]); // empty result = not found or not public
    await expect(getPublicVenue(VENUE_ID, deps)).rejects.toThrow(
      expect.objectContaining({ code: 'VENUE_NOT_FOUND' }),
    );
  });

  it('throws VENUE_NOT_FOUND when venue does not exist', async () => {
    const deps = makeDeps([[]]);
    await expect(getPublicVenue('nonexistent-id', deps)).rejects.toThrow(VenueError);
  });
});

// ---------------------------------------------------------------------------
// createVenue
// ---------------------------------------------------------------------------
describe('createVenue()', () => {
  it('inserts venue with owner_promoter_id = promoterId', async () => {
    const row = makeVenueRow({ owner_promoter_id: PROMOTER_A });
    // query calls: 1. slug LIKE check, 2. INSERT RETURNING
    const deps = makeDeps([[], [row]]);
    const venue = await createVenue(PROMOTER_A, {
      name: 'Test Venue',
      address: 'Addr',
      city: 'Prague',
      capacity: 500,
    }, deps);
    expect(venue.ownerPromoterId).toBe(PROMOTER_A);
  });

  it('generates slug from venue name', async () => {
    const row = makeVenueRow({ slug: 'test-venue', owner_promoter_id: PROMOTER_A });
    const deps = makeDeps([[], [row]]);
    const venue = await createVenue(PROMOTER_A, {
      name: 'Test Venue',
      address: 'Addr',
      city: 'Prague',
      capacity: 500,
    }, deps);
    expect(venue.slug).toBe('test-venue');
  });

  it('emits Kafka event venue.created', async () => {
    const row = makeVenueRow({ owner_promoter_id: PROMOTER_A });
    const deps = makeDeps([[], [row]]);
    await createVenue(PROMOTER_A, {
      name: 'Test Venue',
      address: 'Addr',
      city: 'Prague',
      capacity: 500,
    }, deps);
    expect(deps.kafka.send).toHaveBeenCalledWith('venue.created', expect.objectContaining({
      venueId: VENUE_ID,
      promoterId: PROMOTER_A,
    }));
  });

  it('returns VenueWithOwnership including createdAt and updatedAt', async () => {
    const row = makeVenueRow({ owner_promoter_id: PROMOTER_A });
    const deps = makeDeps([[], [row]]);
    const venue = await createVenue(PROMOTER_A, {
      name: 'Test Venue',
      address: 'Addr',
      city: 'Prague',
      capacity: 500,
    }, deps);
    expect(venue.createdAt).toBeDefined();
    expect(venue.updatedAt).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// updateVenue
// ---------------------------------------------------------------------------
describe('updateVenue()', () => {
  it('owner can update their private venue', async () => {
    const existing = makeVenueRow({ is_public: false, owner_promoter_id: PROMOTER_A });
    const updated = makeVenueRow({ name: 'New Name', is_public: false, owner_promoter_id: PROMOTER_A });
    // query calls: 1. slug check (if name changes), 2. SELECT existing, 3. UPDATE RETURNING
    // actual order: SELECT existing, generateSlug LIKE check, UPDATE
    const deps = makeDeps([[existing], [], [updated]]);
    const venue = await updateVenue(VENUE_ID, PROMOTER_A, { name: 'New Name' }, deps);
    expect(venue.name).toBe('New Name');
  });

  it('throws VENUE_ACCESS_DENIED when promoter is not the owner', async () => {
    const existing = makeVenueRow({ owner_promoter_id: PROMOTER_A });
    const deps = makeDeps([[existing]]);
    await expect(
      updateVenue(VENUE_ID, PROMOTER_B, { name: 'Hacked' }, deps),
    ).rejects.toThrow(expect.objectContaining({ code: 'VENUE_ACCESS_DENIED', statusCode: 404 }));
  });

  it('throws VENUE_NOT_EDITABLE when venue is public (even if owner)', async () => {
    const existing = makeVenueRow({ is_public: true, owner_promoter_id: PROMOTER_A });
    const deps = makeDeps([[existing]]);
    await expect(
      updateVenue(VENUE_ID, PROMOTER_A, { name: 'Edit Public' }, deps),
    ).rejects.toThrow(expect.objectContaining({ code: 'VENUE_NOT_EDITABLE', statusCode: 403 }));
  });

  it('throws VENUE_ACCESS_DENIED when venue does not exist', async () => {
    const deps = makeDeps([[]]);
    await expect(
      updateVenue(VENUE_ID, PROMOTER_A, {}, deps),
    ).rejects.toThrow(expect.objectContaining({ code: 'VENUE_ACCESS_DENIED' }));
  });
});

// ---------------------------------------------------------------------------
// deleteVenue
// ---------------------------------------------------------------------------
describe('deleteVenue()', () => {
  it('deletes venue when owner and no future events', async () => {
    const existing = makeVenueRow({ owner_promoter_id: PROMOTER_A });
    // SELECT venue, COUNT future events, DELETE
    const deps = makeDeps([[existing], [{ count: '0' }]]);
    await expect(deleteVenue(VENUE_ID, PROMOTER_A, deps)).resolves.toBeUndefined();
    expect(deps.db.execute).toHaveBeenCalled();
  });

  it('throws VENUE_HAS_EVENTS when venue has upcoming events', async () => {
    const existing = makeVenueRow({ owner_promoter_id: PROMOTER_A });
    const deps = makeDeps([[existing], [{ count: '3' }]]);
    await expect(deleteVenue(VENUE_ID, PROMOTER_A, deps)).rejects.toThrow(
      expect.objectContaining({ code: 'VENUE_HAS_EVENTS', statusCode: 422 }),
    );
  });

  it('throws VENUE_ACCESS_DENIED when promoter is not the owner', async () => {
    const existing = makeVenueRow({ owner_promoter_id: PROMOTER_A });
    const deps = makeDeps([[existing]]);
    await expect(deleteVenue(VENUE_ID, PROMOTER_B, deps)).rejects.toThrow(
      expect.objectContaining({ code: 'VENUE_ACCESS_DENIED', statusCode: 404 }),
    );
  });

  it('emits Kafka venue.deleted on successful delete', async () => {
    const existing = makeVenueRow({ owner_promoter_id: PROMOTER_A });
    const deps = makeDeps([[existing], [{ count: '0' }]]);
    await deleteVenue(VENUE_ID, PROMOTER_A, deps);
    expect(deps.kafka.send).toHaveBeenCalledWith('venue.deleted', expect.objectContaining({
      venueId: VENUE_ID,
      promoterId: PROMOTER_A,
    }));
  });
});

// ---------------------------------------------------------------------------
// makeVenuePublic
// ---------------------------------------------------------------------------
describe('makeVenuePublic()', () => {
  it('sets is_public = TRUE for the owner', async () => {
    const existing = makeVenueRow({ is_public: false, owner_promoter_id: PROMOTER_A });
    const updated = makeVenueRow({ is_public: true, owner_promoter_id: PROMOTER_A });
    const deps = makeDeps([[existing], [updated]]);
    const venue = await makeVenuePublic(VENUE_ID, PROMOTER_A, deps);
    expect(venue.isPublic).toBe(true);
  });

  it('throws VENUE_ACCESS_DENIED for non-owner', async () => {
    const existing = makeVenueRow({ owner_promoter_id: PROMOTER_A });
    const deps = makeDeps([[existing]]);
    await expect(makeVenuePublic(VENUE_ID, PROMOTER_B, deps)).rejects.toThrow(
      expect.objectContaining({ code: 'VENUE_ACCESS_DENIED', statusCode: 404 }),
    );
  });

  it('emits Kafka venue.made_public', async () => {
    const existing = makeVenueRow({ owner_promoter_id: PROMOTER_A });
    const updated = makeVenueRow({ is_public: true, owner_promoter_id: PROMOTER_A });
    const deps = makeDeps([[existing], [updated]]);
    await makeVenuePublic(VENUE_ID, PROMOTER_A, deps);
    expect(deps.kafka.send).toHaveBeenCalledWith('venue.made_public', expect.objectContaining({
      venueId: VENUE_ID,
    }));
  });
});

// ---------------------------------------------------------------------------
// makeVenuePrivate
// ---------------------------------------------------------------------------
describe('makeVenuePrivate()', () => {
  it('sets is_public = FALSE when no other promoter events exist', async () => {
    const existing = makeVenueRow({ is_public: true, owner_promoter_id: PROMOTER_A });
    const updated = makeVenueRow({ is_public: false, owner_promoter_id: PROMOTER_A });
    // SELECT venue, COUNT other events, UPDATE
    const deps = makeDeps([[existing], [{ count: '0' }], [updated]]);
    const venue = await makeVenuePrivate(VENUE_ID, PROMOTER_A, deps);
    expect(venue.isPublic).toBe(false);
  });

  it('throws VENUE_HAS_EVENTS when another promoter has events at the venue', async () => {
    const existing = makeVenueRow({ is_public: true, owner_promoter_id: PROMOTER_A });
    const deps = makeDeps([[existing], [{ count: '2' }]]);
    await expect(makeVenuePrivate(VENUE_ID, PROMOTER_A, deps)).rejects.toThrow(
      expect.objectContaining({ code: 'VENUE_HAS_EVENTS', statusCode: 422 }),
    );
  });

  it('error from makeVenuePrivate includes affectedEventCount in details', async () => {
    const existing = makeVenueRow({ is_public: true, owner_promoter_id: PROMOTER_A });
    const deps = makeDeps([[existing], [{ count: '5' }]]);
    try {
      await makeVenuePrivate(VENUE_ID, PROMOTER_A, deps);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(VenueError);
      const venueErr = err as VenueError;
      expect(venueErr.details?.affectedEventCount).toBe(5);
    }
  });
});

// ---------------------------------------------------------------------------
// adminCreatePublicVenue
// ---------------------------------------------------------------------------
describe('adminCreatePublicVenue()', () => {
  it('creates venue with owner_promoter_id = NULL and is_public = TRUE', async () => {
    const row = makeVenueRow({ is_public: true, owner_promoter_id: null });
    const deps = makeDeps([[], [row]]);
    const venue = await adminCreatePublicVenue(
      { name: 'National Arena', address: 'Addr', city: 'Prague', capacity: 10000 },
      ADMIN_ID,
      deps,
    );
    expect(venue.ownerPromoterId).toBeNull();
    expect(venue.isPublic).toBe(true);
  });

  it('emits Kafka venue.created with isPublic: true', async () => {
    const row = makeVenueRow({ is_public: true, owner_promoter_id: null });
    const deps = makeDeps([[], [row]]);
    await adminCreatePublicVenue(
      { name: 'National Arena', address: 'Addr', city: 'Prague', capacity: 10000 },
      ADMIN_ID,
      deps,
    );
    expect(deps.kafka.send).toHaveBeenCalledWith('venue.created', expect.objectContaining({
      isPublic: true,
      adminUserId: ADMIN_ID,
    }));
  });
});

// ---------------------------------------------------------------------------
// adminTransferVenue
// ---------------------------------------------------------------------------
describe('adminTransferVenue()', () => {
  it('changes owner_promoter_id to new promoter', async () => {
    const existing = makeVenueRow({ owner_promoter_id: PROMOTER_A });
    const updated = makeVenueRow({ owner_promoter_id: PROMOTER_B });
    const deps = makeDeps([[existing], [updated]]);
    const venue = await adminTransferVenue(VENUE_ID, PROMOTER_B, ADMIN_ID, deps);
    expect(venue.ownerPromoterId).toBe(PROMOTER_B);
  });

  it('emits Kafka venue.ownership_transferred with previous and new owner', async () => {
    const existing = makeVenueRow({ owner_promoter_id: PROMOTER_A });
    const updated = makeVenueRow({ owner_promoter_id: PROMOTER_B });
    const deps = makeDeps([[existing], [updated]]);
    await adminTransferVenue(VENUE_ID, PROMOTER_B, ADMIN_ID, deps);
    expect(deps.kafka.send).toHaveBeenCalledWith(
      'venue.ownership_transferred',
      expect.objectContaining({
        venueId: VENUE_ID,
        previousOwnerPromoterId: PROMOTER_A,
        newOwnerPromoterId: PROMOTER_B,
        adminUserId: ADMIN_ID,
      }),
    );
  });

  it('throws VENUE_NOT_FOUND when venue does not exist', async () => {
    const deps = makeDeps([[]]);
    await expect(adminTransferVenue('bad-id', PROMOTER_B, ADMIN_ID, deps)).rejects.toThrow(
      expect.objectContaining({ code: 'VENUE_NOT_FOUND' }),
    );
  });
});

// ---------------------------------------------------------------------------
// listVenuesForPromoter
// ---------------------------------------------------------------------------
describe('listVenuesForPromoter()', () => {
  it('returns own private venues and all public venues', async () => {
    const ownVenue = makeVenueRow({ is_public: false, owner_promoter_id: PROMOTER_A });
    const publicVenue = makeVenueRow({
      id: 'public-id',
      is_public: true,
      owner_promoter_id: null,
    });
    const deps = makeDeps([[ownVenue, publicVenue]]);
    const venues = await listVenuesForPromoter(PROMOTER_A, {}, deps);
    expect(venues).toHaveLength(2);
    // SQL includes the OR condition
    const sql = (deps.db.query as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(sql).toContain('is_public = TRUE');
  });

  it('returns only public venues when promoter has no own venues', async () => {
    const publicVenue = makeVenueRow({ is_public: true, owner_promoter_id: null });
    const deps = makeDeps([[publicVenue]]);
    const venues = await listVenuesForPromoter(PROMOTER_B, {}, deps);
    expect(venues.every((v) => v.isPublic)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// adminListVenues
// ---------------------------------------------------------------------------
describe('adminListVenues()', () => {
  it('returns all venues without filter', async () => {
    const v1 = makeVenueRow({ is_public: true, owner_promoter_id: null });
    const v2 = makeVenueRow({ id: 'v2', is_public: false, owner_promoter_id: PROMOTER_A });
    const deps = makeDeps([[{ count: '2' }], [v1, v2]]);
    const result = await adminListVenues({}, {}, deps);
    expect(result.total).toBe(2);
    expect(result.items).toHaveLength(2);
  });

  it('filters by isPublic = true', async () => {
    const row = makeVenueRow({ is_public: true, owner_promoter_id: null });
    const deps = makeDeps([[{ count: '1' }], [row]]);
    const result = await adminListVenues({ isPublic: true }, {}, deps);
    expect(result.total).toBe(1);
    // SQL should contain is_public
    const sql = (deps.db.query as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(sql).toContain('is_public');
  });

  it('filters by isPublic = false', async () => {
    const row = makeVenueRow({ is_public: false, owner_promoter_id: PROMOTER_A });
    const deps = makeDeps([[{ count: '1' }], [row]]);
    const result = await adminListVenues({ isPublic: false }, {}, deps);
    expect(result.total).toBe(1);
  });

  it('filters by ownerPromoterId', async () => {
    const row = makeVenueRow({ owner_promoter_id: PROMOTER_A });
    const deps = makeDeps([[{ count: '1' }], [row]]);
    const result = await adminListVenues({ ownerPromoterId: PROMOTER_A }, {}, deps);
    expect(result.items[0].ownerPromoterId).toBe(PROMOTER_A);
  });
});
