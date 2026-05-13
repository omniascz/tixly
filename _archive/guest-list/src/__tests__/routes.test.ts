import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ---------------------------------------------------------------------------
// Route-level tests for guest-list HTTP endpoints
// Focus: Zod validation, auth (x-user-id), status codes, error handling
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Mock adapters — must be defined before vi.mock
// ---------------------------------------------------------------------------

const mockDb = {
  findGuest: vi.fn(),
  findGuestByEmail: vi.fn(),
  createGuest: vi.fn(),
  updateGuest: vi.fn(),
  listGuestsByEvent: vi.fn(),
  checkOrganizerOwnership: vi.fn(),
  getEventSummary: vi.fn(),
  withTransaction: vi.fn((fn: Function) => fn()),
};

const mockKafka = {
  send: vi.fn(),
};

// Mock the adapters module (both .js and non-.js imports)
vi.mock('../lib/adapters', () => ({
  getAdapters: () => ({ db: mockDb, kafka: mockKafka }),
}));
vi.mock('../lib/adapters.js', () => ({
  getAdapters: () => ({ db: mockDb, kafka: mockKafka }),
}));

// Mock GuestListService static methods
const mockServiceMethods = {
  addGuest: vi.fn(),
  bulkAddGuests: vi.fn(),
  confirmAttendance: vi.fn(),
  checkInGuest: vi.fn(),
  markNoShow: vi.fn(),
  removeGuest: vi.fn(),
  searchGuests: vi.fn(),
  getEventSummary: vi.fn(),
};

vi.mock('../services/guest-list.service', () => ({
  GuestListService: mockServiceMethods,
}));
vi.mock('../services/guest-list.service.js', () => ({
  GuestListService: mockServiceMethods,
}));

// Mock csv-parser
vi.mock('../lib/csv-parser.js', () => ({
  parseGuestCsv: vi.fn(),
  GuestListCsvError: class GuestListCsvError extends Error {
    constructor(msg: string) { super(msg); this.name = 'GuestListCsvError'; }
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(url: string, options?: RequestInit): NextRequest {
  return new NextRequest(new URL(url, 'http://localhost:3000'), options);
}

function makeAuthRequest(url: string, options?: RequestInit & { userId?: string; role?: string }): NextRequest {
  const { userId = 'user-1', role, ...rest } = options || {};
  const headers = new Headers(rest.headers || {});
  headers.set('x-user-id', userId);
  if (role) headers.set('x-user-role', role);
  return new NextRequest(new URL(url, 'http://localhost:3000'), { ...rest, headers });
}

function jsonBody(data: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockDb.checkOrganizerOwnership.mockResolvedValue(true);
});

// =============================================================================
// GET /api/events/[eventId]/guest-list
// =============================================================================

describe('GET /api/events/[eventId]/guest-list', () => {
  let handler: typeof import('../app/api/events/[eventId]/guest-list/route');

  beforeEach(async () => {
    handler = await import('../app/api/events/[eventId]/guest-list/route');
  });

  it('returns 401 without x-user-id header', async () => {
    const req = makeRequest('/api/events/evt-1/guest-list');
    const res = await handler.GET(req, { params: { eventId: 'evt-1' } });
    expect(res.status).toBe(401);
  });

  it('returns 403 when user is not organizer', async () => {
    mockDb.checkOrganizerOwnership.mockResolvedValue(false);
    const req = makeAuthRequest('/api/events/evt-1/guest-list');
    const res = await handler.GET(req, { params: { eventId: 'evt-1' } });
    expect(res.status).toBe(403);
  });

  it('returns 200 with guests list', async () => {
    const guests = [{ id: 'g1', name: 'Jan', status: 'invited' }];
    mockDb.listGuestsByEvent.mockResolvedValue(guests);

    const req = makeAuthRequest('/api/events/evt-1/guest-list');
    const res = await handler.GET(req, { params: { eventId: 'evt-1' } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.guests).toHaveLength(1);
    expect(body.total).toBe(1);
  });

  it('returns 400 for invalid status filter', async () => {
    const req = makeAuthRequest('/api/events/evt-1/guest-list?status=invalid');
    const res = await handler.GET(req, { params: { eventId: 'evt-1' } });
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid type filter', async () => {
    const req = makeAuthRequest('/api/events/evt-1/guest-list?type=invalid');
    const res = await handler.GET(req, { params: { eventId: 'evt-1' } });
    expect(res.status).toBe(400);
  });

  it('delegates to searchGuests when q param is present', async () => {
    mockServiceMethods.searchGuests.mockResolvedValue({ guests: [], total: 0 });
    const req = makeAuthRequest('/api/events/evt-1/guest-list?q=jan');
    const res = await handler.GET(req, { params: { eventId: 'evt-1' } });
    expect(res.status).toBe(200);
    expect(mockServiceMethods.searchGuests).toHaveBeenCalledWith('evt-1', 'jan', mockDb);
  });
});

// =============================================================================
// POST /api/events/[eventId]/guest-list
// =============================================================================

describe('POST /api/events/[eventId]/guest-list', () => {
  let handler: typeof import('../app/api/events/[eventId]/guest-list/route');

  beforeEach(async () => {
    handler = await import('../app/api/events/[eventId]/guest-list/route');
  });

  const validGuest = {
    name: 'Jan Novak',
    guest_type: 'vip',
    plus_count: 1,
  };

  it('returns 401 without x-user-id header', async () => {
    const req = makeRequest('/api/events/evt-1/guest-list', jsonBody(validGuest));
    const res = await handler.POST(req, { params: { eventId: 'evt-1' } });
    expect(res.status).toBe(401);
  });

  it('returns 403 when not organizer', async () => {
    mockDb.checkOrganizerOwnership.mockResolvedValue(false);
    const req = makeAuthRequest('/api/events/evt-1/guest-list', jsonBody(validGuest));
    const res = await handler.POST(req, { params: { eventId: 'evt-1' } });
    expect(res.status).toBe(403);
  });

  it('returns 400 for missing name', async () => {
    const req = makeAuthRequest('/api/events/evt-1/guest-list', jsonBody({ guest_type: 'vip' }));
    const res = await handler.POST(req, { params: { eventId: 'evt-1' } });
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid guest_type', async () => {
    const req = makeAuthRequest('/api/events/evt-1/guest-list', jsonBody({ ...validGuest, guest_type: 'invalid' }));
    const res = await handler.POST(req, { params: { eventId: 'evt-1' } });
    expect(res.status).toBe(400);
  });

  it('returns 400 for plus_count > 9', async () => {
    const req = makeAuthRequest('/api/events/evt-1/guest-list', jsonBody({ ...validGuest, plus_count: 10 }));
    const res = await handler.POST(req, { params: { eventId: 'evt-1' } });
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid email', async () => {
    const req = makeAuthRequest('/api/events/evt-1/guest-list', jsonBody({ ...validGuest, email: 'not-email' }));
    const res = await handler.POST(req, { params: { eventId: 'evt-1' } });
    expect(res.status).toBe(400);
  });

  it('returns 201 on successful add', async () => {
    mockServiceMethods.addGuest.mockResolvedValue({ id: 'g-new', name: 'Jan Novak', status: 'invited' });
    const req = makeAuthRequest('/api/events/evt-1/guest-list', jsonBody(validGuest));
    const res = await handler.POST(req, { params: { eventId: 'evt-1' } });
    expect(res.status).toBe(201);
  });
});

// =============================================================================
// POST /api/events/[eventId]/guest-list/bulk
// =============================================================================

describe('POST /api/events/[eventId]/guest-list/bulk', () => {
  let handler: typeof import('../app/api/events/[eventId]/guest-list/bulk/route');

  beforeEach(async () => {
    handler = await import('../app/api/events/[eventId]/guest-list/bulk/route');
  });

  it('returns 401 without x-user-id header', async () => {
    const req = makeRequest('/api/events/evt-1/guest-list/bulk', jsonBody({ guests: [{ name: 'A', guest_type: 'vip' }] }));
    const res = await handler.POST(req, { params: { eventId: 'evt-1' } });
    expect(res.status).toBe(401);
  });

  it('returns 403 when not organizer', async () => {
    mockDb.checkOrganizerOwnership.mockResolvedValue(false);
    const req = makeAuthRequest('/api/events/evt-1/guest-list/bulk', jsonBody({ guests: [{ name: 'A', guest_type: 'vip' }] }));
    const res = await handler.POST(req, { params: { eventId: 'evt-1' } });
    expect(res.status).toBe(403);
  });

  it('returns 400 for empty guests array', async () => {
    const req = makeAuthRequest('/api/events/evt-1/guest-list/bulk', jsonBody({ guests: [] }));
    const res = await handler.POST(req, { params: { eventId: 'evt-1' } });
    expect(res.status).toBe(400);
  });
});

// =============================================================================
// GET /api/events/[eventId]/guest-list/summary
// =============================================================================

describe('GET /api/events/[eventId]/guest-list/summary', () => {
  let handler: typeof import('../app/api/events/[eventId]/guest-list/summary/route');

  beforeEach(async () => {
    handler = await import('../app/api/events/[eventId]/guest-list/summary/route');
  });

  it('returns 401 without x-user-id header', async () => {
    const req = makeRequest('/api/events/evt-1/guest-list/summary');
    const res = await handler.GET(req, { params: { eventId: 'evt-1' } });
    expect(res.status).toBe(401);
  });

  it('returns 403 when not organizer and not staff', async () => {
    mockDb.checkOrganizerOwnership.mockResolvedValue(false);
    const req = makeAuthRequest('/api/events/evt-1/guest-list/summary');
    const res = await handler.GET(req, { params: { eventId: 'evt-1' } });
    expect(res.status).toBe(403);
  });

  it('returns 200 for organizer', async () => {
    const summary = { total: 5, invited: 2, confirmed: 2, checked_in: 1, no_show: 0, cancelled: 0, total_headcount: 8 };
    mockServiceMethods.getEventSummary.mockResolvedValue(summary);

    const req = makeAuthRequest('/api/events/evt-1/guest-list/summary');
    const res = await handler.GET(req, { params: { eventId: 'evt-1' } });
    expect(res.status).toBe(200);
  });

  it('returns 200 for staff role even if not organizer', async () => {
    mockDb.checkOrganizerOwnership.mockResolvedValue(false);
    const summary = { total: 10, invited: 5, confirmed: 3, checked_in: 1, no_show: 0, cancelled: 1, total_headcount: 15 };
    mockServiceMethods.getEventSummary.mockResolvedValue(summary);

    const req = makeAuthRequest('/api/events/evt-1/guest-list/summary', { role: 'staff' });
    const res = await handler.GET(req, { params: { eventId: 'evt-1' } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total).toBe(10);
  });
});

// =============================================================================
// POST /api/guest-list/confirm/[guestId] (public — no auth)
// =============================================================================

describe('POST /api/guest-list/confirm/[guestId]', () => {
  let handler: typeof import('../app/api/guest-list/confirm/[guestId]/route');

  beforeEach(async () => {
    handler = await import('../app/api/guest-list/confirm/[guestId]/route');
  });

  it('returns 200 on successful confirmation', async () => {
    mockServiceMethods.confirmAttendance.mockResolvedValue({ id: 'g-1', status: 'confirmed' });
    const req = makeRequest('/api/guest-list/confirm/g-1', { method: 'POST' });
    const res = await handler.POST(req, { params: { guestId: 'g-1' } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('confirmed');
  });
});

// =============================================================================
// PATCH /api/guest-list/[guestId]
// =============================================================================

describe('PATCH /api/guest-list/[guestId]', () => {
  let handler: typeof import('../app/api/guest-list/[guestId]/route');

  beforeEach(async () => {
    handler = await import('../app/api/guest-list/[guestId]/route');
  });

  it('returns 401 without x-user-id header', async () => {
    const req = makeRequest('/api/guest-list/g-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes: 'test' }),
    });
    const res = await handler.PATCH(req, { params: { guestId: 'g-1' } });
    expect(res.status).toBe(401);
  });

  it('returns 400 for invalid plus_count', async () => {
    const req = makeAuthRequest('/api/guest-list/g-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plus_count: 10 }),
    });
    const res = await handler.PATCH(req, { params: { guestId: 'g-1' } });
    expect(res.status).toBe(400);
  });

  it('returns 404 when guest not found', async () => {
    mockDb.findGuest.mockResolvedValue(null);
    const req = makeAuthRequest('/api/guest-list/g-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes: 'test' }),
    });
    const res = await handler.PATCH(req, { params: { guestId: 'g-1' } });
    expect(res.status).toBe(404);
  });

  it('returns 403 when not organizer', async () => {
    mockDb.findGuest.mockResolvedValue({ id: 'g-1', event_id: 'evt-1' });
    mockDb.checkOrganizerOwnership.mockResolvedValue(false);
    const req = makeAuthRequest('/api/guest-list/g-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes: 'test' }),
    });
    const res = await handler.PATCH(req, { params: { guestId: 'g-1' } });
    expect(res.status).toBe(403);
  });

  it('returns 200 on successful update', async () => {
    mockDb.findGuest.mockResolvedValue({ id: 'g-1', event_id: 'evt-1' });
    mockDb.updateGuest.mockResolvedValue({ id: 'g-1', notes: 'updated' });

    const req = makeAuthRequest('/api/guest-list/g-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes: 'updated' }),
    });
    const res = await handler.PATCH(req, { params: { guestId: 'g-1' } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.notes).toBe('updated');
  });
});

// =============================================================================
// DELETE /api/guest-list/[guestId]
// =============================================================================

describe('DELETE /api/guest-list/[guestId]', () => {
  let handler: typeof import('../app/api/guest-list/[guestId]/route');

  beforeEach(async () => {
    handler = await import('../app/api/guest-list/[guestId]/route');
  });

  it('returns 401 without x-user-id header', async () => {
    const req = makeRequest('/api/guest-list/g-1', { method: 'DELETE' });
    const res = await handler.DELETE(req, { params: { guestId: 'g-1' } });
    expect(res.status).toBe(401);
  });

  it('returns 204 on successful delete', async () => {
    mockServiceMethods.removeGuest.mockResolvedValue(undefined);
    const req = makeAuthRequest('/api/guest-list/g-1', { method: 'DELETE' });
    const res = await handler.DELETE(req, { params: { guestId: 'g-1' } });
    expect(res.status).toBe(204);
  });
});

// =============================================================================
// POST /api/guest-list/[guestId]/check-in
// =============================================================================

describe('POST /api/guest-list/[guestId]/check-in', () => {
  let handler: typeof import('../app/api/guest-list/[guestId]/check-in/route');

  beforeEach(async () => {
    handler = await import('../app/api/guest-list/[guestId]/check-in/route');
  });

  it('returns 401 without x-user-id header', async () => {
    const req = makeRequest('/api/guest-list/g-1/check-in', jsonBody({ staff_id: 's1' }));
    const res = await handler.POST(req, { params: { guestId: 'g-1' } });
    expect(res.status).toBe(401);
  });

  it('returns 400 for missing staff_id', async () => {
    const req = makeAuthRequest('/api/guest-list/g-1/check-in', jsonBody({}));
    const res = await handler.POST(req, { params: { guestId: 'g-1' } });
    expect(res.status).toBe(400);
  });

  it('returns 400 for empty staff_id', async () => {
    const req = makeAuthRequest('/api/guest-list/g-1/check-in', jsonBody({ staff_id: '' }));
    const res = await handler.POST(req, { params: { guestId: 'g-1' } });
    expect(res.status).toBe(400);
  });

  it('returns 200 on successful check-in', async () => {
    const guest = {
      id: 'g-1', name: 'Jan Novak', status: 'checked_in',
      guest_type: 'vip', plus_count: 0, checked_in_at: new Date(),
    };
    mockServiceMethods.checkInGuest.mockResolvedValue(guest);

    const req = makeAuthRequest('/api/guest-list/g-1/check-in', jsonBody({ staff_id: 's1' }));
    const res = await handler.POST(req, { params: { guestId: 'g-1' } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.guest).toBeDefined();
    expect(body.confirmation).toBeDefined();
  });
});
