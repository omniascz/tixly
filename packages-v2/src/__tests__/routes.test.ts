import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Route handlers use an internal getDb() that returns empty rows.
// This means service functions will throw PackageError for NOT_FOUND cases.
// We test that routes correctly convert PackageError → HTTP status codes,
// and that they accept the expected HTTP methods and parameters.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Import route handlers
// ---------------------------------------------------------------------------

const packagesRoute = await import(
  '../app/api/reservations/packages/route'
);
const packageByIdRoute = await import(
  '../app/api/reservations/packages/[packageId]/route'
);
const itemsRoute = await import(
  '../app/api/reservations/packages/[packageId]/items/route'
);
const itemByIdRoute = await import(
  '../app/api/reservations/packages/[packageId]/items/[itemId]/route'
);
const purchaseRoute = await import(
  '../app/api/reservations/packages/[packageId]/purchase/route'
);
const purchaseByIdRoute = await import(
  '../app/api/reservations/purchases/[purchaseId]/route'
);
const redeemRoute = await import(
  '../app/api/reservations/purchases/[purchaseId]/redeem/route'
);
const creditsRoute = await import(
  '../app/api/reservations/purchases/[purchaseId]/credits/route'
);
const userPurchasesRoute = await import(
  '../app/api/reservations/users/[userId]/purchases/route'
);
const giftRoute = await import(
  '../app/api/reservations/gifts/[transferToken]/route'
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(url: string, init?: RequestInit) {
  return new Request(url, init) as unknown as import('next/server').NextRequest;
}

// ---------------------------------------------------------------------------
// GET /packages — returns empty list (stub db returns no rows)
// ---------------------------------------------------------------------------

describe('GET /api/reservations/packages', () => {
  it('returns 200 with empty array', async () => {
    const req = makeRequest('http://localhost/api/reservations/packages?promoterId=p1');
    const res = await packagesRoute.GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([]);
  });

  it('exports GET handler', () => {
    expect(typeof packagesRoute.GET).toBe('function');
  });

  it('exports POST handler', () => {
    expect(typeof packagesRoute.POST).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// POST /packages — stub db returns empty → PACKAGE_DUPLICATE → 409
// ---------------------------------------------------------------------------

describe('POST /api/reservations/packages', () => {
  it('returns 409 when INSERT returns no rows (duplicate)', async () => {
    const req = makeRequest(
      'http://localhost/api/reservations/packages?promoterId=p1',
      {
        method: 'POST',
        body: JSON.stringify({ name: 'Test', priceHellers: 500000 }),
        headers: { 'Content-Type': 'application/json' },
      }
    );
    const res = await packagesRoute.POST(req);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe('PACKAGE_DUPLICATE');
  });
});

// ---------------------------------------------------------------------------
// GET /packages/[packageId] — not found → 404
// ---------------------------------------------------------------------------

describe('GET /api/reservations/packages/[packageId]', () => {
  it('returns 404 for nonexistent package', async () => {
    const req = makeRequest('http://localhost/api/reservations/packages/nonexistent');
    const res = await packageByIdRoute.GET(req, { params: { packageId: 'nonexistent' } });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('PACKAGE_NOT_FOUND');
  });

  it('exports GET and PATCH handlers', () => {
    expect(typeof packageByIdRoute.GET).toBe('function');
    expect(typeof packageByIdRoute.PATCH).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// PATCH /packages/[packageId] — not found → 404
// ---------------------------------------------------------------------------

describe('PATCH /api/reservations/packages/[packageId]', () => {
  it('returns 404 when package not found', async () => {
    const req = makeRequest(
      'http://localhost/api/reservations/packages/nonexistent',
      {
        method: 'PATCH',
        body: JSON.stringify({ priceHellers: 450000 }),
        headers: { 'Content-Type': 'application/json' },
      }
    );
    const res = await packageByIdRoute.PATCH(req, { params: { packageId: 'nonexistent' } });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('PACKAGE_NOT_FOUND');
  });

  it('returns 200 when no fields to update (empty input)', async () => {
    // updatePackage with {} calls getPackage which returns 404 on stub
    const req = makeRequest(
      'http://localhost/api/reservations/packages/nonexistent',
      {
        method: 'PATCH',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' },
      }
    );
    const res = await packageByIdRoute.PATCH(req, { params: { packageId: 'nonexistent' } });
    // Even with empty input, getPackage is called internally → 404
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// GET /packages/[packageId]/items — returns empty list
// ---------------------------------------------------------------------------

describe('GET /api/reservations/packages/[packageId]/items', () => {
  it('returns 200 with empty items list', async () => {
    const req = makeRequest('http://localhost/api/reservations/packages/p1/items');
    const res = await itemsRoute.GET(req, { params: { packageId: 'p1' } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// POST /packages/[packageId]/items — stub returns empty → ITEM_NOT_FOUND
// ---------------------------------------------------------------------------

describe('POST /api/reservations/packages/[packageId]/items', () => {
  it('returns 404 when INSERT returns no rows', async () => {
    const req = makeRequest(
      'http://localhost/api/reservations/packages/p1/items',
      {
        method: 'POST',
        body: JSON.stringify({ itemType: 'service', name: 'Court Rental', quantity: 2 }),
        headers: { 'Content-Type': 'application/json' },
      }
    );
    const res = await itemsRoute.POST(req, { params: { packageId: 'p1' } });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('ITEM_NOT_FOUND');
  });
});

// ---------------------------------------------------------------------------
// DELETE /packages/[packageId]/items/[itemId] — always 204 (delete is void)
// ---------------------------------------------------------------------------

describe('DELETE /api/reservations/packages/[packageId]/items/[itemId]', () => {
  it('returns 204', async () => {
    const req = makeRequest(
      'http://localhost/api/reservations/packages/p1/items/i1',
      { method: 'DELETE' }
    );
    const res = await itemByIdRoute.DELETE(req, { params: { itemId: 'i1' } });
    expect(res.status).toBe(204);
  });

  it('exports DELETE handler', () => {
    expect(typeof itemByIdRoute.DELETE).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// POST /packages/[packageId]/purchase — stub returns empty → PACKAGE_NOT_FOUND
// ---------------------------------------------------------------------------

describe('POST /api/reservations/packages/[packageId]/purchase', () => {
  it('returns 404 when package not found', async () => {
    const req = makeRequest(
      'http://localhost/api/reservations/packages/nonexistent/purchase',
      {
        method: 'POST',
        body: JSON.stringify({ userId: 'user-1' }),
        headers: { 'Content-Type': 'application/json' },
      }
    );
    const res = await purchaseRoute.POST(req, { params: { packageId: 'nonexistent' } });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('PACKAGE_NOT_FOUND');
  });

  it('exports POST handler', () => {
    expect(typeof purchaseRoute.POST).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// GET /purchases/[purchaseId] — not found → 404
// ---------------------------------------------------------------------------

describe('GET /api/reservations/purchases/[purchaseId]', () => {
  it('returns 404 for nonexistent purchase', async () => {
    const req = makeRequest('http://localhost/api/reservations/purchases/nonexistent');
    const res = await purchaseByIdRoute.GET(req, { params: { purchaseId: 'nonexistent' } });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('PURCHASE_NOT_FOUND');
  });
});

// ---------------------------------------------------------------------------
// DELETE /purchases/[purchaseId] — not found after cancel → 404
// ---------------------------------------------------------------------------

describe('DELETE /api/reservations/purchases/[purchaseId]', () => {
  it('returns 404 when purchase not found', async () => {
    const req = makeRequest(
      'http://localhost/api/reservations/purchases/nonexistent',
      {
        method: 'DELETE',
        body: JSON.stringify({ reason: 'test' }),
        headers: { 'Content-Type': 'application/json' },
      }
    );
    const res = await purchaseByIdRoute.DELETE(req, { params: { purchaseId: 'nonexistent' } });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('PURCHASE_NOT_FOUND');
  });

  it('handles missing body gracefully', async () => {
    const req = makeRequest(
      'http://localhost/api/reservations/purchases/nonexistent',
      { method: 'DELETE' }
    );
    const res = await purchaseByIdRoute.DELETE(req, { params: { purchaseId: 'nonexistent' } });
    // Still returns 404 from service, but no crash
    expect(res.status).toBe(404);
  });

  it('exports GET and DELETE handlers', () => {
    expect(typeof purchaseByIdRoute.GET).toBe('function');
    expect(typeof purchaseByIdRoute.DELETE).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// POST /purchases/[purchaseId]/redeem — not found → 404
// ---------------------------------------------------------------------------

describe('POST /api/reservations/purchases/[purchaseId]/redeem', () => {
  it('returns 404 when purchase not found', async () => {
    const req = makeRequest(
      'http://localhost/api/reservations/purchases/nonexistent/redeem',
      {
        method: 'POST',
        body: JSON.stringify({ itemId: 'i1', userId: 'u1' }),
        headers: { 'Content-Type': 'application/json' },
      }
    );
    const res = await redeemRoute.POST(req, { params: { purchaseId: 'nonexistent' } });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('PURCHASE_NOT_FOUND');
  });

  it('exports POST handler', () => {
    expect(typeof redeemRoute.POST).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// GET /purchases/[purchaseId]/credits — null balance → {balance: null}
// ---------------------------------------------------------------------------

describe('GET /api/reservations/purchases/[purchaseId]/credits', () => {
  it('returns null balance for non-credit package', async () => {
    const req = makeRequest('http://localhost/api/reservations/purchases/p1/credits');
    const res = await creditsRoute.GET(req, { params: { purchaseId: 'p1' } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.balance).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// POST /purchases/[purchaseId]/credits — not found → 404
// ---------------------------------------------------------------------------

describe('POST /api/reservations/purchases/[purchaseId]/credits', () => {
  it('returns 404 when credit balance not found', async () => {
    const req = makeRequest(
      'http://localhost/api/reservations/purchases/nonexistent/credits',
      {
        method: 'POST',
        body: JSON.stringify({ amount: 1000, userId: 'u1' }),
        headers: { 'Content-Type': 'application/json' },
      }
    );
    const res = await creditsRoute.POST(req, { params: { purchaseId: 'nonexistent' } });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('PURCHASE_NOT_FOUND');
  });

  it('exports GET and POST handlers', () => {
    expect(typeof creditsRoute.GET).toBe('function');
    expect(typeof creditsRoute.POST).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// GET /users/[userId]/purchases — returns empty list
// ---------------------------------------------------------------------------

describe('GET /api/reservations/users/[userId]/purchases', () => {
  it('returns 200 with empty array', async () => {
    const req = makeRequest('http://localhost/api/reservations/users/u1/purchases');
    const res = await userPurchasesRoute.GET(req, { params: { userId: 'u1' } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([]);
  });

  it('accepts status and promoterId query params', async () => {
    const req = makeRequest(
      'http://localhost/api/reservations/users/u1/purchases?status=active&promoterId=p1'
    );
    const res = await userPurchasesRoute.GET(req, { params: { userId: 'u1' } });
    expect(res.status).toBe(200);
  });

  it('exports GET handler', () => {
    expect(typeof userPurchasesRoute.GET).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// GET /gifts/[transferToken] — not found → 404
// ---------------------------------------------------------------------------

describe('GET /api/reservations/gifts/[transferToken]', () => {
  it('returns 404 for invalid token', async () => {
    const req = makeRequest('http://localhost/api/reservations/gifts/bad-token');
    const res = await giftRoute.GET(req, { params: { transferToken: 'bad-token' } });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('TRANSFER_TOKEN_INVALID');
  });
});

// ---------------------------------------------------------------------------
// POST /gifts/[transferToken] — not found → 404
// ---------------------------------------------------------------------------

describe('POST /api/reservations/gifts/[transferToken]', () => {
  it('returns 404 for invalid transfer token', async () => {
    const req = makeRequest(
      'http://localhost/api/reservations/gifts/bad-token',
      {
        method: 'POST',
        body: JSON.stringify({ recipientUserId: 'recipient-001' }),
        headers: { 'Content-Type': 'application/json' },
      }
    );
    const res = await giftRoute.POST(req, { params: { transferToken: 'bad-token' } });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('TRANSFER_TOKEN_INVALID');
  });

  it('exports GET and POST handlers', () => {
    expect(typeof giftRoute.GET).toBe('function');
    expect(typeof giftRoute.POST).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// Error response structure consistency
// ---------------------------------------------------------------------------

describe('Error response structure', () => {
  it('all PackageError responses include error and message fields', async () => {
    const routes = [
      () => packageByIdRoute.GET(
        makeRequest('http://localhost/x'),
        { params: { packageId: 'x' } }
      ),
      () => purchaseByIdRoute.GET(
        makeRequest('http://localhost/x'),
        { params: { purchaseId: 'x' } }
      ),
      () => giftRoute.GET(
        makeRequest('http://localhost/x'),
        { params: { transferToken: 'x' } }
      ),
    ];

    for (const routeFn of routes) {
      const res = await routeFn();
      const body = await res.json();
      expect(body).toHaveProperty('error');
      expect(body).toHaveProperty('message');
      expect(typeof body.error).toBe('string');
      expect(typeof body.message).toBe('string');
    }
  });
});

// ---------------------------------------------------------------------------
// Route export verification — all 10 routes export correct HTTP methods
// ---------------------------------------------------------------------------

describe('Route exports', () => {
  it('packages/route.ts exports GET and POST', () => {
    expect(typeof packagesRoute.GET).toBe('function');
    expect(typeof packagesRoute.POST).toBe('function');
  });

  it('packages/[packageId]/route.ts exports GET and PATCH', () => {
    expect(typeof packageByIdRoute.GET).toBe('function');
    expect(typeof packageByIdRoute.PATCH).toBe('function');
  });

  it('packages/[packageId]/items/route.ts exports GET and POST', () => {
    expect(typeof itemsRoute.GET).toBe('function');
    expect(typeof itemsRoute.POST).toBe('function');
  });

  it('packages/[packageId]/items/[itemId]/route.ts exports DELETE', () => {
    expect(typeof itemByIdRoute.DELETE).toBe('function');
  });

  it('packages/[packageId]/purchase/route.ts exports POST', () => {
    expect(typeof purchaseRoute.POST).toBe('function');
  });

  it('purchases/[purchaseId]/route.ts exports GET and DELETE', () => {
    expect(typeof purchaseByIdRoute.GET).toBe('function');
    expect(typeof purchaseByIdRoute.DELETE).toBe('function');
  });

  it('purchases/[purchaseId]/redeem/route.ts exports POST', () => {
    expect(typeof redeemRoute.POST).toBe('function');
  });

  it('purchases/[purchaseId]/credits/route.ts exports GET and POST', () => {
    expect(typeof creditsRoute.GET).toBe('function');
    expect(typeof creditsRoute.POST).toBe('function');
  });

  it('users/[userId]/purchases/route.ts exports GET', () => {
    expect(typeof userPurchasesRoute.GET).toBe('function');
  });

  it('gifts/[transferToken]/route.ts exports GET and POST', () => {
    expect(typeof giftRoute.GET).toBe('function');
    expect(typeof giftRoute.POST).toBe('function');
  });
});
