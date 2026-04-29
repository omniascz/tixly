import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock next/server before importing route
vi.mock('next/server', () => {
  class MockNextRequest {
    private _headers: Map<string, string>;
    constructor(url: string, init?: { headers?: Record<string, string> }) {
      this._headers = new Map(Object.entries(init?.headers ?? {}));
    }
    get headers() {
      const headers = this._headers;
      return {
        get: (key: string) => headers.get(key) ?? null,
      };
    }
  }

  class MockNextResponse {
    static json(body: unknown, init?: { status?: number }) {
      return { body, status: init?.status ?? 200 };
    }
  }

  return {
    NextRequest: MockNextRequest,
    NextResponse: MockNextResponse,
  };
});

const mockListReports = vi.fn();

vi.mock('../../../../services/post-event-report.service', () => {
  return {
    PostEventReportService: vi.fn().mockImplementation(() => ({
      listReports: mockListReports,
    })),
  };
});

import { GET } from './route';
import { NextRequest } from 'next/server';

describe('GET /api/organizer/reports', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('should return 401 when x-organizer-id header is missing', async () => {
    const request = new NextRequest('http://localhost/api/organizer/reports');

    const response = await GET(request);

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'Unauthorized' });
  });

  it('should return 500 when service throws', async () => {
    mockListReports.mockRejectedValue(new Error('Database connection failed'));

    const request = new NextRequest('http://localhost/api/organizer/reports', {
      headers: { 'x-organizer-id': 'org_123' },
    });

    const response = await GET(request);

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'Failed to retrieve reports' });
  });

  it('should return reports on success', async () => {
    const mockReports = [
      { event_id: 'event_1', event_name: 'Concert', sellthrough_pct: 80 },
    ];
    mockListReports.mockResolvedValue(mockReports);

    const request = new NextRequest('http://localhost/api/organizer/reports', {
      headers: { 'x-organizer-id': 'org_123' },
    });

    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(response.body).toEqual(mockReports);
  });
});
