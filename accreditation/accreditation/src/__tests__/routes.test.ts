import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import {
  AccreditationNotFoundError,
  AccreditationUnauthorizedError,
  AccreditationDuplicateError,
} from '../types/accreditation.types';

// ---------------------------------------------------------------------------
// Route-level tests for accreditation HTTP endpoints
// Focus: Zod validation, status codes, error handling at HTTP layer
//
// Strategy: We import route handlers and mock the service+db at module level.
// Routes instantiate AccreditationService and use a stub db — we mock the
// constructor to return our controlled mock, and mock db methods.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Shared mock service
// ---------------------------------------------------------------------------

const mockService = {
  requestAccreditation: vi.fn(),
  approveAccreditation: vi.fn(),
  rejectAccreditation: vi.fn(),
  issueAccreditation: vi.fn(),
  activateAccreditation: vi.fn(),
  revokeAccreditation: vi.fn(),
  scanAccreditation: vi.fn(),
  listEventAccreditations: vi.fn(),
};

const mockDb = {
  findAccreditation: vi.fn(),
  findAccreditationByQr: vi.fn(),
  findByEmail: vi.fn(),
  createAccreditation: vi.fn(),
  updateAccreditation: vi.fn(),
  listByEvent: vi.fn(),
  checkOrganizerOwnership: vi.fn(),
  getZonesByIds: vi.fn(),
};

// Mock the service module — constructor returns our mock
// Use multiple path variants because routes import with different relative paths
vi.mock('@services/accreditation.service', () => ({
  AccreditationService: vi.fn().mockImplementation(() => mockService),
}));
vi.mock('../services/accreditation.service', () => ({
  AccreditationService: vi.fn().mockImplementation(() => mockService),
}));

// Mock the validator module
vi.mock('@lib/accreditation-validator', () => ({
  getBadgeColor: vi.fn().mockReturnValue('#f59e0b'),
  generateAccreditationQr: vi.fn().mockReturnValue('ACC-MOCK12345678'),
  canScanAccreditation: vi.fn().mockReturnValue({ allowed: true }),
  validateAccreditationRequest: vi.fn(),
}));
vi.mock('../lib/accreditation-validator', () => ({
  getBadgeColor: vi.fn().mockReturnValue('#f59e0b'),
  generateAccreditationQr: vi.fn().mockReturnValue('ACC-MOCK12345678'),
  canScanAccreditation: vi.fn().mockReturnValue({ allowed: true }),
  validateAccreditationRequest: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(url: string, options?: RequestInit): NextRequest {
  return new NextRequest(new URL(url, 'http://localhost:3000'), options);
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
});

// =============================================================================
// POST /api/accreditations/scan
// =============================================================================

describe('POST /api/accreditations/scan', () => {
  let handler: typeof import('../app/api/accreditations/scan/route');

  beforeEach(async () => {
    handler = await import('../app/api/accreditations/scan/route');
  });

  it('returns 400 for empty body', async () => {
    const req = makeRequest('/api/accreditations/scan', jsonBody({}));
    const res = await handler.POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Validation error');
  });

  it('returns 400 for missing qr_code', async () => {
    const req = makeRequest('/api/accreditations/scan', jsonBody({ zone_ids: ['z1'] }));
    const res = await handler.POST(req);
    expect(res.status).toBe(400);
  });

  it('returns 400 for empty zone_ids', async () => {
    const req = makeRequest('/api/accreditations/scan', jsonBody({ qr_code: 'ACC-123', zone_ids: [] }));
    const res = await handler.POST(req);
    expect(res.status).toBe(400);
  });

  it('returns 200 with scan result on valid input', async () => {
    mockService.scanAccreditation.mockResolvedValue({
      allowed: true,
      accreditation_id: 'acc-1',
      holder_name: 'Jan Novak',
      accreditation_type: 'staff',
      badge_color: '#f59e0b',
      zone_name: 'Zone A',
      valid_today: true,
    });

    const req = makeRequest('/api/accreditations/scan', jsonBody({ qr_code: 'ACC-123', zone_ids: ['z1'] }));
    const res = await handler.POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.allowed).toBe(true);
    expect(body.holder_name).toBe('Jan Novak');
  });

  it('returns 200 with denial on failed scan (never 4xx)', async () => {
    mockService.scanAccreditation.mockResolvedValue({
      allowed: false,
      accreditation_id: '',
      holder_name: '',
      accreditation_type: 'staff',
      badge_color: '#f59e0b',
      zone_name: '',
      valid_today: false,
      reason: 'Akreditace nebyla nalezena.',
    });

    const req = makeRequest('/api/accreditations/scan', jsonBody({ qr_code: 'INVALID', zone_ids: ['z1'] }));
    const res = await handler.POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.allowed).toBe(false);
  });

  it('returns 200 with safe denial on infrastructure error', async () => {
    mockService.scanAccreditation.mockRejectedValue(new Error('DB connection failed'));

    const req = makeRequest('/api/accreditations/scan', jsonBody({ qr_code: 'ACC-123', zone_ids: ['z1'] }));
    const res = await handler.POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.allowed).toBe(false);
  });

  it('returns 400 for invalid JSON body', async () => {
    const req = makeRequest('/api/accreditations/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json',
    });
    const res = await handler.POST(req);
    expect(res.status).toBe(400);
  });
});

// =============================================================================
// POST /api/accreditations/[accreditationId]/approve
// =============================================================================

describe('POST /api/accreditations/[accreditationId]/approve', () => {
  let handler: typeof import('../app/api/accreditations/[accreditationId]/approve/route');

  beforeEach(async () => {
    handler = await import('../app/api/accreditations/[accreditationId]/approve/route');
  });

  it('returns 400 for invalid JSON', async () => {
    const req = makeRequest('/api/accreditations/acc-1/approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'bad',
    });
    const res = await handler.POST(req, { params: { accreditationId: 'acc-1' } });
    expect(res.status).toBe(400);
  });

  it('returns 400 for missing approved_by_user_id', async () => {
    const req = makeRequest('/api/accreditations/acc-1/approve', jsonBody({}));
    const res = await handler.POST(req, { params: { accreditationId: 'acc-1' } });
    expect(res.status).toBe(400);
  });

  it('returns 404 when accreditation not found', async () => {
    mockService.approveAccreditation.mockRejectedValue(new AccreditationNotFoundError('acc-1'));
    const req = makeRequest('/api/accreditations/acc-1/approve', jsonBody({ approved_by_user_id: 'u1' }));
    const res = await handler.POST(req, { params: { accreditationId: 'acc-1' } });
    expect(res.status).toBe(404);
  });

  it('returns 200 on successful approval', async () => {
    mockService.approveAccreditation.mockResolvedValue({ id: 'acc-1', status: 'approved' });
    const req = makeRequest('/api/accreditations/acc-1/approve', jsonBody({ approved_by_user_id: 'u1' }));
    const res = await handler.POST(req, { params: { accreditationId: 'acc-1' } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('approved');
  });
});

// =============================================================================
// POST /api/accreditations/[accreditationId]/reject
// =============================================================================

describe('POST /api/accreditations/[accreditationId]/reject', () => {
  let handler: typeof import('../app/api/accreditations/[accreditationId]/reject/route');

  beforeEach(async () => {
    handler = await import('../app/api/accreditations/[accreditationId]/reject/route');
  });

  it('returns 400 for missing reason', async () => {
    const req = makeRequest('/api/accreditations/acc-1/reject', jsonBody({ user_id: 'u1' }));
    const res = await handler.POST(req, { params: { accreditationId: 'acc-1' } });
    expect(res.status).toBe(400);
  });

  it('returns 400 for missing user_id', async () => {
    const req = makeRequest('/api/accreditations/acc-1/reject', jsonBody({ reason: 'Not eligible' }));
    const res = await handler.POST(req, { params: { accreditationId: 'acc-1' } });
    expect(res.status).toBe(400);
  });

  it('returns 404 when accreditation not found', async () => {
    mockService.rejectAccreditation.mockRejectedValue(new AccreditationNotFoundError('acc-1'));
    const req = makeRequest('/api/accreditations/acc-1/reject', jsonBody({ reason: 'No', user_id: 'u1' }));
    const res = await handler.POST(req, { params: { accreditationId: 'acc-1' } });
    expect(res.status).toBe(404);
  });

  it('returns 200 on successful rejection', async () => {
    mockService.rejectAccreditation.mockResolvedValue({ id: 'acc-1', status: 'rejected' });
    const req = makeRequest('/api/accreditations/acc-1/reject', jsonBody({ reason: 'No', user_id: 'u1' }));
    const res = await handler.POST(req, { params: { accreditationId: 'acc-1' } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('rejected');
  });
});

// =============================================================================
// POST /api/accreditations/[accreditationId]/issue
// =============================================================================

describe('POST /api/accreditations/[accreditationId]/issue', () => {
  let handler: typeof import('../app/api/accreditations/[accreditationId]/issue/route');

  beforeEach(async () => {
    handler = await import('../app/api/accreditations/[accreditationId]/issue/route');
  });

  it('returns 400 for missing user_id', async () => {
    const req = makeRequest('/api/accreditations/acc-1/issue', jsonBody({}));
    const res = await handler.POST(req, { params: { accreditationId: 'acc-1' } });
    expect(res.status).toBe(400);
  });

  it('returns 404 when not found', async () => {
    mockService.issueAccreditation.mockRejectedValue(new AccreditationNotFoundError('acc-1'));
    const req = makeRequest('/api/accreditations/acc-1/issue', jsonBody({ user_id: 'u1' }));
    const res = await handler.POST(req, { params: { accreditationId: 'acc-1' } });
    expect(res.status).toBe(404);
  });

  it('returns 200 on successful issue', async () => {
    mockService.issueAccreditation.mockResolvedValue({ id: 'acc-1', status: 'issued' });
    const req = makeRequest('/api/accreditations/acc-1/issue', jsonBody({ user_id: 'u1' }));
    const res = await handler.POST(req, { params: { accreditationId: 'acc-1' } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('issued');
  });
});

// =============================================================================
// POST /api/accreditations/[accreditationId]/revoke
// =============================================================================

describe('POST /api/accreditations/[accreditationId]/revoke', () => {
  let handler: typeof import('../app/api/accreditations/[accreditationId]/revoke/route');

  beforeEach(async () => {
    handler = await import('../app/api/accreditations/[accreditationId]/revoke/route');
  });

  it('returns 400 for missing reason', async () => {
    const req = makeRequest('/api/accreditations/acc-1/revoke', jsonBody({ user_id: 'u1' }));
    const res = await handler.POST(req, { params: { accreditationId: 'acc-1' } });
    expect(res.status).toBe(400);
  });

  it('returns 404 when not found', async () => {
    mockService.revokeAccreditation.mockRejectedValue(new AccreditationNotFoundError('acc-1'));
    const req = makeRequest('/api/accreditations/acc-1/revoke', jsonBody({ reason: 'Violation', user_id: 'u1' }));
    const res = await handler.POST(req, { params: { accreditationId: 'acc-1' } });
    expect(res.status).toBe(404);
  });

  it('returns 200 on successful revocation', async () => {
    mockService.revokeAccreditation.mockResolvedValue({ id: 'acc-1', status: 'revoked' });
    const req = makeRequest('/api/accreditations/acc-1/revoke', jsonBody({ reason: 'Violation', user_id: 'u1' }));
    const res = await handler.POST(req, { params: { accreditationId: 'acc-1' } });
    expect(res.status).toBe(200);
  });
});

// =============================================================================
// GET /api/events/[eventId]/accreditations
// =============================================================================

describe('GET /api/events/[eventId]/accreditations', () => {
  let handler: typeof import('../app/api/events/[eventId]/accreditations/route');

  beforeEach(async () => {
    handler = await import('../app/api/events/[eventId]/accreditations/route');
  });

  it('returns 400 when organizer_id is missing', async () => {
    const req = makeRequest('/api/events/evt-1/accreditations');
    const res = await handler.GET(req, { params: { eventId: 'evt-1' } });
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid type filter', async () => {
    const req = makeRequest('/api/events/evt-1/accreditations?organizer_id=u1&type=invalid');
    const res = await handler.GET(req, { params: { eventId: 'evt-1' } });
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid status filter', async () => {
    const req = makeRequest('/api/events/evt-1/accreditations?organizer_id=u1&status=bogus');
    const res = await handler.GET(req, { params: { eventId: 'evt-1' } });
    expect(res.status).toBe(400);
  });

  it('returns 403 when user is unauthorized', async () => {
    mockService.listEventAccreditations.mockRejectedValue(
      new AccreditationUnauthorizedError('u1', 'evt-1')
    );
    const req = makeRequest('/api/events/evt-1/accreditations?organizer_id=u1');
    const res = await handler.GET(req, { params: { eventId: 'evt-1' } });
    expect(res.status).toBe(403);
  });

  it('returns 200 with accreditations list', async () => {
    mockService.listEventAccreditations.mockResolvedValue([{ id: 'acc-1', status: 'active' }]);
    const req = makeRequest('/api/events/evt-1/accreditations?organizer_id=u1');
    const res = await handler.GET(req, { params: { eventId: 'evt-1' } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(1);
  });
});

// =============================================================================
// POST /api/events/[eventId]/accreditations
// =============================================================================

describe('POST /api/events/[eventId]/accreditations', () => {
  let handler: typeof import('../app/api/events/[eventId]/accreditations/route');

  beforeEach(async () => {
    handler = await import('../app/api/events/[eventId]/accreditations/route');
  });

  const validBody = {
    holder_name: 'Jan Novak',
    holder_email: 'jan@example.com',
    accreditation_type: 'press',
    zone_access: ['zone-1'],
    requested_by_user_id: 'u1',
  };

  it('returns 400 for invalid JSON', async () => {
    const req = makeRequest('/api/events/evt-1/accreditations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'bad',
    });
    const res = await handler.POST(req, { params: { eventId: 'evt-1' } });
    expect(res.status).toBe(400);
  });

  it('returns 400 for empty holder_name', async () => {
    const req = makeRequest('/api/events/evt-1/accreditations', jsonBody({ ...validBody, holder_name: '' }));
    const res = await handler.POST(req, { params: { eventId: 'evt-1' } });
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid email', async () => {
    const req = makeRequest('/api/events/evt-1/accreditations', jsonBody({ ...validBody, holder_email: 'not-email' }));
    const res = await handler.POST(req, { params: { eventId: 'evt-1' } });
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid accreditation_type', async () => {
    const req = makeRequest('/api/events/evt-1/accreditations', jsonBody({ ...validBody, accreditation_type: 'invalid' }));
    const res = await handler.POST(req, { params: { eventId: 'evt-1' } });
    expect(res.status).toBe(400);
  });

  it('returns 400 for empty zone_access', async () => {
    const req = makeRequest('/api/events/evt-1/accreditations', jsonBody({ ...validBody, zone_access: [] }));
    const res = await handler.POST(req, { params: { eventId: 'evt-1' } });
    expect(res.status).toBe(400);
  });

  it('returns 400 for missing requested_by_user_id', async () => {
    const { requested_by_user_id: _, ...noUserId } = validBody;
    const req = makeRequest('/api/events/evt-1/accreditations', jsonBody(noUserId));
    const res = await handler.POST(req, { params: { eventId: 'evt-1' } });
    expect(res.status).toBe(400);
  });

  it('returns 409 on duplicate email', async () => {
    mockService.requestAccreditation.mockRejectedValue(
      new AccreditationDuplicateError('jan@example.com', 'evt-1')
    );
    const req = makeRequest('/api/events/evt-1/accreditations', jsonBody(validBody));
    const res = await handler.POST(req, { params: { eventId: 'evt-1' } });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe('ACCREDITATION_DUPLICATE');
  });

  it('returns 201 on successful creation', async () => {
    mockService.requestAccreditation.mockResolvedValue({ id: 'acc-new', status: 'requested' });
    const req = makeRequest('/api/events/evt-1/accreditations', jsonBody(validBody));
    const res = await handler.POST(req, { params: { eventId: 'evt-1' } });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toBe('acc-new');
  });
});
