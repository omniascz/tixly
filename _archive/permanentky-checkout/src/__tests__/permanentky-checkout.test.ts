import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  detectPermanentkaItems,
  validatePackageAvailability,
  reservePackage,
  linkOrderToPackage,
  activatePackageForOrder,
  cancelPackageReservation,
  getRemainingUsages,
} from '../services/permanentky-checkout.service.js';
import type { DbAdapter, CheckoutItem } from '../lib/types.js';

// =============================================================================
// Mock DbAdapter factory
// =============================================================================

function createMockDb(overrides: Partial<DbAdapter> = {}): DbAdapter {
  return {
    query: vi.fn().mockResolvedValue([]),
    execute: vi.fn().mockResolvedValue(undefined),
    transaction: vi.fn().mockImplementation(async (fn) => fn(createMockDb(overrides))),
    ...overrides,
  };
}

// =============================================================================
// detectPermanentkaItems
// =============================================================================

describe('detectPermanentkaItems', () => {
  it('1. filtruje items bez packageId — vrátí prázdné pole', () => {
    const items: CheckoutItem[] = [
      { ticketTypeId: 'tt-1', quantity: 2, unitPriceHalire: 50000 },
      { ticketTypeId: 'tt-2', quantity: 1, unitPriceHalire: 30000 },
    ];
    expect(detectPermanentkaItems(items)).toEqual([]);
  });

  it('2. vrátí prázdné pole pro prázdný košík', () => {
    expect(detectPermanentkaItems([])).toEqual([]);
  });

  it('3. vrátí permanentky items pokud packageId přítomno', () => {
    const items: CheckoutItem[] = [
      {
        packageId: 'pkg-uuid-1',
        packageType: 'season_pass',
        quantity: 1,
        unitPriceHalire: 100000,
      },
    ];
    const result = detectPermanentkaItems(items);
    expect(result).toHaveLength(1);
    expect(result[0].packageId).toBe('pkg-uuid-1');
    expect(result[0].packageType).toBe('season_pass');
    expect(result[0].quantity).toBe(1);
    expect(result[0].unitPriceHalire).toBe(100000);
  });

  it('4. smíšené items — vrátí jen ty s packageId', () => {
    const items: CheckoutItem[] = [
      { ticketTypeId: 'tt-1', quantity: 2, unitPriceHalire: 50000 },
      { packageId: 'pkg-1', packageType: 'flex', quantity: 1, unitPriceHalire: 200000 },
      { ticketTypeId: 'tt-3', quantity: 1, unitPriceHalire: 25000 },
      { packageId: 'pkg-2', packageType: 'multi_entry', quantity: 2, unitPriceHalire: 80000 },
    ];
    const result = detectPermanentkaItems(items);
    expect(result).toHaveLength(2);
    expect(result[0].packageId).toBe('pkg-1');
    expect(result[1].packageId).toBe('pkg-2');
  });

  it('4b. item s packageId ale bez packageType — defaultuje na season_pass', () => {
    const items: CheckoutItem[] = [
      { packageId: 'pkg-no-type', quantity: 1, unitPriceHalire: 100000 },
    ];
    const result = detectPermanentkaItems(items);
    expect(result[0].packageType).toBe('season_pass');
  });
});

// =============================================================================
// validatePackageAvailability
// =============================================================================

describe('validatePackageAvailability', () => {
  it('5. vrátí package pokud existuje a je active', async () => {
    const mockRow = {
      id: 'pkg-1',
      promoter_id: 'promo-1',
      name: 'Roční permanentka',
      package_type: 'season_pass',
      price_halire: 500000,
      max_usages: 52,
      status: 'active',
    };
    const db = createMockDb({ query: vi.fn().mockResolvedValue([mockRow]) });

    const result = await validatePackageAvailability('pkg-1', 'promo-1', 1, db);

    expect(result.id).toBe('pkg-1');
    expect(result.promoterId).toBe('promo-1');
    expect(result.name).toBe('Roční permanentka');
    expect(result.status).toBe('active');
    expect(result.maxUsages).toBe(52);
  });

  it('6. hodí error pokud package not found', async () => {
    const db = createMockDb({ query: vi.fn().mockResolvedValue([]) });

    await expect(
      validatePackageAvailability('nonexistent', 'promo-1', 1, db),
    ).rejects.toThrow('Package not found or does not belong to promoter');
  });

  it('7. hodí error pokud status=sold_out', async () => {
    const mockRow = {
      id: 'pkg-sold',
      promoter_id: 'promo-1',
      name: 'Vyprodaná permanentka',
      package_type: 'season_pass',
      price_halire: 500000,
      max_usages: 52,
      status: 'sold_out',
    };
    const db = createMockDb({ query: vi.fn().mockResolvedValue([mockRow]) });

    await expect(
      validatePackageAvailability('pkg-sold', 'promo-1', 1, db),
    ).rejects.toThrow('Package is not available for purchase');
  });

  it('8. hodí error pokud promoter nesedí (tenant isolation) — query vrátí prázdno', async () => {
    // DB vrátí prázdno protože SQL filtruje AND promoter_id = $2
    const db = createMockDb({ query: vi.fn().mockResolvedValue([]) });

    await expect(
      validatePackageAvailability('pkg-1', 'wrong-promoter', 1, db),
    ).rejects.toThrow('Package not found or does not belong to promoter');
  });
});

// =============================================================================
// reservePackage
// =============================================================================

describe('reservePackage', () => {
  it('9. volá INSERT do permanentky_reservations', async () => {
    const executeMock = vi.fn().mockResolvedValue(undefined);
    const db = createMockDb({
      query: vi.fn().mockResolvedValue([{ id: 'pkg-1' }]),
      execute: executeMock,
    });

    await reservePackage('pkg-1', 'order-1', 2, 'promo-1', db);

    expect(executeMock).toHaveBeenCalledOnce();
    const sql: string = executeMock.mock.calls[0][0];
    expect(sql).toContain('INSERT INTO permanentky_reservations');
    expect(sql).toContain("'reserved'");
  });

  it('10. vrátí PurchasePackageResult s status=reserved', async () => {
    const db = createMockDb({
      query: vi.fn().mockResolvedValue([{ id: 'pkg-1' }]),
      execute: vi.fn().mockResolvedValue(undefined),
    });

    const result = await reservePackage('pkg-1', 'order-abc', 1, 'promo-1', db);

    expect(result.packageId).toBe('pkg-1');
    expect(result.orderId).toBe('order-abc');
    expect(result.status).toBe('reserved');
    expect(result.reservationId).toBeDefined();
    expect(typeof result.reservationId).toBe('string');
    expect(result.reservationId.length).toBeGreaterThan(0);
  });

  it('11. hodí error pokud package not found při rezervaci', async () => {
    const db = createMockDb({
      query: vi.fn().mockResolvedValue([]),
      execute: vi.fn().mockResolvedValue(undefined),
    });

    await expect(
      reservePackage('nonexistent', 'order-1', 1, 'promo-1', db),
    ).rejects.toThrow('Package not found during reservation');
  });
});

// =============================================================================
// linkOrderToPackage
// =============================================================================

describe('linkOrderToPackage', () => {
  it('12. volá INSERT do order_packages', async () => {
    const executeMock = vi.fn().mockResolvedValue(undefined);
    const db = createMockDb({ execute: executeMock });

    await linkOrderToPackage('order-1', 'pkg-1', 3, db);

    expect(executeMock).toHaveBeenCalledOnce();
    const sql: string = executeMock.mock.calls[0][0];
    expect(sql).toContain('INSERT INTO order_packages');
  });

  it('13. vrátí OrderPackageLink s správnými hodnotami', async () => {
    const db = createMockDb({ execute: vi.fn().mockResolvedValue(undefined) });

    const result = await linkOrderToPackage('order-xyz', 'pkg-abc', 2, db);

    expect(result.orderId).toBe('order-xyz');
    expect(result.packageId).toBe('pkg-abc');
    expect(result.quantity).toBe(2);
    expect(result.createdAt).toBeDefined();
    expect(typeof result.createdAt).toBe('string');
  });
});

// =============================================================================
// activatePackageForOrder
// =============================================================================

describe('activatePackageForOrder', () => {
  it('14. najde reservations a aktualizuje na active', async () => {
    const reservationRows = [
      {
        id: 'res-1',
        package_id: 'pkg-1',
        order_id: 'order-1',
        quantity: 1,
        status: 'reserved',
        expires_at: new Date().toISOString(),
        activated_at: null,
        created_at: new Date().toISOString(),
      },
    ];
    const executeMock = vi.fn().mockResolvedValue(undefined);
    const db = createMockDb({
      query: vi.fn().mockResolvedValue(reservationRows),
      execute: executeMock,
    });

    await activatePackageForOrder('order-1', 'promo-1', db);

    // Should call UPDATE permanentky_reservations and UPDATE order_packages
    expect(executeMock).toHaveBeenCalledTimes(2);
    const firstCall: string = executeMock.mock.calls[0][0];
    expect(firstCall).toContain('UPDATE permanentky_reservations');
    expect(firstCall).toContain("'active'");
  });

  it('15. vrátí ActivatePackageResult[] s activatedAt', async () => {
    const reservationRows = [
      {
        id: 'res-1',
        package_id: 'pkg-1',
        order_id: 'order-1',
        quantity: 3,
        status: 'reserved',
        expires_at: new Date().toISOString(),
        activated_at: null,
        created_at: new Date().toISOString(),
      },
    ];
    const db = createMockDb({
      query: vi.fn().mockResolvedValue(reservationRows),
      execute: vi.fn().mockResolvedValue(undefined),
    });

    const results = await activatePackageForOrder('order-1', 'promo-1', db);

    expect(results).toHaveLength(1);
    expect(results[0].packageId).toBe('pkg-1');
    expect(results[0].orderId).toBe('order-1');
    expect(results[0].usagesGranted).toBe(3);
    expect(results[0].activatedAt).toBeDefined();
    expect(typeof results[0].activatedAt).toBe('string');
  });

  it('16. vrátí prázdné pole pokud žádné rezervace', async () => {
    const db = createMockDb({ query: vi.fn().mockResolvedValue([]) });

    const results = await activatePackageForOrder('order-no-reservations', 'promo-1', db);

    expect(results).toEqual([]);
  });
});

// =============================================================================
// cancelPackageReservation
// =============================================================================

describe('cancelPackageReservation', () => {
  it('17. volá UPDATE se status=cancelled', async () => {
    const executeMock = vi.fn().mockResolvedValue(undefined);
    const db = createMockDb({ execute: executeMock });

    await cancelPackageReservation('res-abc', db);

    expect(executeMock).toHaveBeenCalledOnce();
    const [sql, params] = executeMock.mock.calls[0];
    expect(sql).toContain('UPDATE permanentky_reservations');
    expect(sql).toContain("'cancelled'");
    expect(params).toContain('res-abc');
  });
});

// =============================================================================
// getRemainingUsages
// =============================================================================

describe('getRemainingUsages', () => {
  it('18. vrátí remaining a total', async () => {
    const queryMock = vi
      .fn()
      .mockResolvedValueOnce([{ max_usages: 52 }])  // package query
      .mockResolvedValueOnce([{ used_count: '10' }]); // usage count
    const db = createMockDb({ query: queryMock });

    const result = await getRemainingUsages('pkg-1', 'user-1', db);

    expect(result.total).toBe(52);
    expect(result.remaining).toBe(42);
  });

  it('19. remaining = total - použité (edge: všechny použity)', async () => {
    const queryMock = vi
      .fn()
      .mockResolvedValueOnce([{ max_usages: 10 }])
      .mockResolvedValueOnce([{ used_count: '10' }]);
    const db = createMockDb({ query: queryMock });

    const result = await getRemainingUsages('pkg-full', 'user-1', db);

    expect(result.remaining).toBe(0);
    expect(result.total).toBe(10);
  });

  it('19b. remaining nikdy není záporné', async () => {
    const queryMock = vi
      .fn()
      .mockResolvedValueOnce([{ max_usages: 5 }])
      .mockResolvedValueOnce([{ used_count: '99' }]); // více než max (edge case)
    const db = createMockDb({ query: queryMock });

    const result = await getRemainingUsages('pkg-over', 'user-1', db);

    expect(result.remaining).toBe(0);
  });

  it('19c. hodí error pokud package neexistuje', async () => {
    const db = createMockDb({ query: vi.fn().mockResolvedValue([]) });

    await expect(getRemainingUsages('nonexistent', 'user-1', db)).rejects.toThrow(
      'Package not found',
    );
  });
});

// =============================================================================
// Integrační test
// =============================================================================

describe('Integrační test: detectPermanentkaItems + validatePackageAvailability + reservePackage', () => {
  it('20. kompletní checkout flow pro permanentku', async () => {
    // Krok 1: detekce permanentky v košíku
    const cartItems: CheckoutItem[] = [
      { ticketTypeId: 'tt-regular', quantity: 1, unitPriceHalire: 50000 },
      {
        packageId: 'pkg-season-2026',
        packageType: 'season_pass',
        quantity: 1,
        unitPriceHalire: 499900,
      },
    ];

    const permanentkyItems = detectPermanentkaItems(cartItems);
    expect(permanentkyItems).toHaveLength(1);
    expect(permanentkyItems[0].packageId).toBe('pkg-season-2026');

    // Krok 2: validace dostupnosti
    const packageRow = {
      id: 'pkg-season-2026',
      promoter_id: 'promo-festival',
      name: 'Festivalová sezóna 2026',
      package_type: 'season_pass',
      price_halire: 499900,
      max_usages: 30,
      status: 'active',
    };

    const reservationExecuteMock = vi.fn().mockResolvedValue(undefined);
    const db = createMockDb({
      query: vi.fn()
        .mockResolvedValueOnce([packageRow])          // validatePackageAvailability
        .mockResolvedValueOnce([{ id: 'pkg-season-2026' }]), // reservePackage lookup
      execute: reservationExecuteMock,
    });

    const pkg = await validatePackageAvailability(
      permanentkyItems[0].packageId,
      'promo-festival',
      permanentkyItems[0].quantity,
      db,
    );
    expect(pkg.status).toBe('active');
    expect(pkg.priceHalire).toBe(499900);

    // Krok 3: rezervace před platbou
    const reservation = await reservePackage(
      permanentkyItems[0].packageId,
      'order-integration-test',
      permanentkyItems[0].quantity,
      'promo-festival',
      db,
    );

    expect(reservation.status).toBe('reserved');
    expect(reservation.packageId).toBe('pkg-season-2026');
    expect(reservation.orderId).toBe('order-integration-test');
    expect(reservation.reservationId).toBeDefined();

    // Ověření že INSERT byl zavolán
    expect(reservationExecuteMock).toHaveBeenCalledOnce();
    const insertSql: string = reservationExecuteMock.mock.calls[0][0];
    expect(insertSql).toContain('INSERT INTO permanentky_reservations');
  });
});
