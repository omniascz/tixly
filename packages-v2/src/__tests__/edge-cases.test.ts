import { describe, it, expect, vi } from 'vitest';
import { PackageError, isPackageError, type PackageErrorCode } from '../lib/package-errors';
import {
  createPackage,
  getPackage,
  listPackages,
  updatePackage,
  addItem,
  removeItem,
  listItems,
} from '../services/package.service';
import {
  purchasePackage,
  getPurchase,
  listPurchasesForUser,
  cancelPurchase,
  activateGift,
} from '../services/purchase.service';
import {
  redeemItem,
  redeemCredit,
  getUsageForPurchase,
  getRemainingQuota,
  getCreditBalance,
} from '../services/usage.service';
import {
  createGiftPackage,
  getGiftByToken,
  claimGift,
} from '../services/gift.service';

// ---------------------------------------------------------------------------
// DB mock helper
// ---------------------------------------------------------------------------

function makeDb(responses: unknown[][] = []) {
  let i = 0;
  return {
    query: vi.fn(async () => ({ rows: responses[i++] ?? [] })),
    execute: vi.fn(async () => {}),
  };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PROMOTER_ID = 'promoter-uuid-0001';
const PACKAGE_ID = 'package-uuid-0001';
const ITEM_ID = 'item-uuid-0001';
const PURCHASE_ID = 'purchase-uuid-0001';
const USER_ID = 'user-uuid-0001';
const now = new Date().toISOString();
const pastDate = new Date(Date.now() - 86400000).toISOString();

const PACKAGE_ROW = {
  id: PACKAGE_ID,
  promoter_id: PROMOTER_ID,
  branch_id: null,
  name: 'Test Package',
  slug: 'test-package',
  description: null,
  short_description: null,
  package_type: 'bundle' as const,
  price_hellers: 500000,
  original_price_hellers: null,
  validity_days: null,
  max_activations: 100,
  activations_sold: 0,
  is_active: true,
  is_featured: false,
  sale_start: null,
  sale_end: null,
  image_url: null,
  terms_text: null,
  created_at: now,
  items_count: '0',
  purchases_count: '0',
};

const PACKAGE_DB_ROW = {
  id: PACKAGE_ID,
  promoter_id: PROMOTER_ID,
  is_active: true,
  sale_start: null,
  sale_end: null,
  activations_sold: 5,
  max_activations: 100,
  validity_days: null,
};

const PURCHASE_ROW = {
  id: PURCHASE_ID,
  package_id: PACKAGE_ID,
  user_id: USER_ID,
  promoter_id: PROMOTER_ID,
  order_id: null,
  status: 'active' as const,
  purchased_at: now,
  activated_at: now,
  expires_at: null,
  gift_recipient_user_id: null,
  gift_message: null,
  transfer_token: null,
  notes: null,
  package_name: 'Test Package',
};

// ---------------------------------------------------------------------------
// PackageError — comprehensive tests
// ---------------------------------------------------------------------------

describe('PackageError', () => {
  it('sets correct statusCode for each error code', () => {
    const codes: Array<[PackageErrorCode, number]> = [
      ['PACKAGE_NOT_FOUND', 404],
      ['PACKAGE_DUPLICATE', 409],
      ['PACKAGE_SOLD_OUT', 409],
      ['PACKAGE_SALE_CLOSED', 422],
      ['PACKAGE_EXPIRED', 422],
      ['ITEM_NOT_FOUND', 404],
      ['PURCHASE_NOT_FOUND', 404],
      ['PURCHASE_EXPIRED', 422],
      ['PURCHASE_FULLY_USED', 422],
      ['PURCHASE_CANCELLED', 422],
      ['ITEM_QUOTA_EXCEEDED', 422],
      ['INSUFFICIENT_CREDITS', 422],
      ['TRANSFER_NOT_ALLOWED', 422],
      ['TRANSFER_TOKEN_INVALID', 404],
    ];

    for (const [code, expectedStatus] of codes) {
      const err = new PackageError(code);
      expect(err.statusCode).toBe(expectedStatus);
      expect(err.code).toBe(code);
      expect(err.name).toBe('PackageError');
      expect(err.message).toBeTruthy();
    }
  });

  it('accepts custom message', () => {
    const err = new PackageError('PACKAGE_NOT_FOUND', 'Custom message');
    expect(err.message).toBe('Custom message');
    expect(err.code).toBe('PACKAGE_NOT_FOUND');
  });

  it('toHttpError returns structured error', () => {
    const err = new PackageError('PACKAGE_SOLD_OUT');
    const http = err.toHttpError();
    expect(http.error).toBe('PACKAGE_SOLD_OUT');
    expect(http.statusCode).toBe(409);
    expect(http.message).toBeTruthy();
  });

  it('isPackageError returns true for PackageError', () => {
    expect(isPackageError(new PackageError('PACKAGE_NOT_FOUND'))).toBe(true);
  });

  it('isPackageError returns false for regular Error', () => {
    expect(isPackageError(new Error('nope'))).toBe(false);
  });

  it('isPackageError returns false for non-error values', () => {
    expect(isPackageError(null)).toBe(false);
    expect(isPackageError(undefined)).toBe(false);
    expect(isPackageError('string')).toBe(false);
    expect(isPackageError(42)).toBe(false);
  });

  it('instanceof check works', () => {
    const err = new PackageError('ITEM_NOT_FOUND');
    expect(err instanceof PackageError).toBe(true);
    expect(err instanceof Error).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Package service — edge cases
// ---------------------------------------------------------------------------

describe('updatePackage — edge cases', () => {
  it('returns existing package when no fields provided', async () => {
    // updatePackage with empty input calls getPackage internally
    const db = makeDb([[PACKAGE_ROW]]); // getPackage query
    const pkg = await updatePackage(PACKAGE_ID, {}, db);

    expect(pkg.id).toBe(PACKAGE_ID);
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  it('returns 404 when package does not exist', async () => {
    const db = makeDb([[]]); // empty result
    await expect(
      updatePackage('nonexistent', { name: 'New Name' }, db)
    ).rejects.toThrow(PackageError);

    try {
      const db2 = makeDb([[]]);
      await updatePackage('nonexistent', { name: 'New Name' }, db2);
    } catch (err) {
      expect((err as PackageError).code).toBe('PACKAGE_NOT_FOUND');
    }
  });
});

describe('getPackage — not found', () => {
  it('throws PACKAGE_NOT_FOUND for nonexistent id', async () => {
    const db = makeDb([[]]);
    await expect(getPackage('nonexistent', db)).rejects.toThrow(PackageError);

    try {
      const db2 = makeDb([[]]);
      await getPackage('nonexistent', db2);
    } catch (err) {
      expect((err as PackageError).code).toBe('PACKAGE_NOT_FOUND');
    }
  });
});

describe('listPackages — multiple filters', () => {
  it('applies all filters simultaneously', async () => {
    const row = { ...PACKAGE_ROW, package_type: 'series', is_active: true, is_featured: true, branch_id: 'branch-1' };
    const db = makeDb([[row]]);
    const packages = await listPackages(PROMOTER_ID, {
      packageType: 'series',
      isActive: true,
      isFeatured: true,
      branchId: 'branch-1',
    }, db);

    expect(packages).toHaveLength(1);
    // Verify SQL contains all filter conditions
    const sql = db.query.mock.calls[0][0] as string;
    expect(sql).toContain('package_type');
    expect(sql).toContain('is_active');
    expect(sql).toContain('is_featured');
    expect(sql).toContain('branch_id');
    // Verify all params passed
    const params = db.query.mock.calls[0][1] as unknown[];
    expect(params).toContain('series');
    expect(params).toContain(true);
    expect(params).toContain('branch-1');
  });

  it('returns empty array when no matches', async () => {
    const db = makeDb([[]]);
    const packages = await listPackages(PROMOTER_ID, { isActive: true }, db);
    expect(packages).toEqual([]);
  });
});

describe('addItem — empty rows → error', () => {
  it('throws ITEM_NOT_FOUND when INSERT returns no rows', async () => {
    const db = makeDb([[]]); // empty result from INSERT
    await expect(
      addItem(PACKAGE_ID, { itemType: 'service', name: 'Test' }, db)
    ).rejects.toThrow(PackageError);

    try {
      const db2 = makeDb([[]]);
      await addItem(PACKAGE_ID, { itemType: 'service', name: 'Test' }, db2);
    } catch (err) {
      expect((err as PackageError).code).toBe('ITEM_NOT_FOUND');
    }
  });
});

describe('listItems — empty package', () => {
  it('returns empty array for package with no items', async () => {
    const db = makeDb([[]]);
    const items = await listItems(PACKAGE_ID, db);
    expect(items).toEqual([]);
  });
});

describe('createPackage — slug generation', () => {
  it('uses provided slug when given', async () => {
    const row = { ...PACKAGE_ROW, slug: 'custom-slug' };
    const db = makeDb([[row]]);
    await createPackage(PROMOTER_ID, {
      name: 'Test',
      slug: 'custom-slug',
      priceHellers: 100,
    }, db);

    const params = db.query.mock.calls[0][1] as unknown[];
    expect(params).toContain('custom-slug');
  });

  it('generates slug from name with diacritics stripped', async () => {
    const row = { ...PACKAGE_ROW, slug: 'hello-world' };
    const db = makeDb([[row]]);
    await createPackage(PROMOTER_ID, {
      name: 'Hello World!!!',
      priceHellers: 100,
    }, db);

    const params = db.query.mock.calls[0][1] as unknown[];
    expect(params).toContain('hello-world');
  });

  it('generates slug stripping consecutive hyphens', async () => {
    const row = { ...PACKAGE_ROW, slug: 'foo-bar' };
    const db = makeDb([[row]]);
    await createPackage(PROMOTER_ID, {
      name: 'Foo---Bar',
      priceHellers: 100,
    }, db);

    const params = db.query.mock.calls[0][1] as unknown[];
    // slug should not contain consecutive hyphens
    const slug = params[3] as string;
    expect(slug).not.toMatch(/--/);
  });
});

// ---------------------------------------------------------------------------
// Purchase service — edge cases
// ---------------------------------------------------------------------------

describe('purchasePackage — package not found', () => {
  it('throws PACKAGE_NOT_FOUND when package does not exist', async () => {
    const db = makeDb([[]]); // empty
    await expect(
      purchasePackage('nonexistent', USER_ID, null, db)
    ).rejects.toThrow(PackageError);

    try {
      const db2 = makeDb([[]]);
      await purchasePackage('nonexistent', USER_ID, null, db2);
    } catch (err) {
      expect((err as PackageError).code).toBe('PACKAGE_NOT_FOUND');
    }
  });
});

describe('purchasePackage — inactive package', () => {
  it('throws PACKAGE_SALE_CLOSED when is_active=false', async () => {
    const inactive = { ...PACKAGE_DB_ROW, is_active: false };
    const db = makeDb([[inactive]]);

    await expect(
      purchasePackage(PACKAGE_ID, USER_ID, null, db)
    ).rejects.toThrow(PackageError);

    try {
      const db2 = makeDb([[inactive]]);
      await purchasePackage(PACKAGE_ID, USER_ID, null, db2);
    } catch (err) {
      expect((err as PackageError).code).toBe('PACKAGE_SALE_CLOSED');
    }
  });
});

describe('getPurchase — not found', () => {
  it('throws PURCHASE_NOT_FOUND', async () => {
    const db = makeDb([[]]);
    await expect(getPurchase('nonexistent', db)).rejects.toThrow(PackageError);

    try {
      const db2 = makeDb([[]]);
      await getPurchase('nonexistent', db2);
    } catch (err) {
      expect((err as PackageError).code).toBe('PURCHASE_NOT_FOUND');
    }
  });
});

describe('cancelPurchase — not found', () => {
  it('throws PURCHASE_NOT_FOUND when id does not exist', async () => {
    const db = makeDb([[]]); // empty after UPDATE
    await expect(
      cancelPurchase('nonexistent', 'reason', db)
    ).rejects.toThrow(PackageError);

    try {
      const db2 = makeDb([[]]);
      await cancelPurchase('nonexistent', 'reason', db2);
    } catch (err) {
      expect((err as PackageError).code).toBe('PURCHASE_NOT_FOUND');
    }
  });
});

describe('listPurchasesForUser — empty result', () => {
  it('returns empty array when user has no purchases', async () => {
    const db = makeDb([[]]);
    const purchases = await listPurchasesForUser(USER_ID, {}, db);
    expect(purchases).toEqual([]);
  });

  it('filters by promoterId', async () => {
    const db = makeDb([[]]);
    await listPurchasesForUser(USER_ID, { promoterId: PROMOTER_ID }, db);

    const sql = db.query.mock.calls[0][0] as string;
    expect(sql).toContain('promoter_id');
    const params = db.query.mock.calls[0][1] as unknown[];
    expect(params).toContain(PROMOTER_ID);
  });
});

describe('activateGift — invalid token', () => {
  it('throws TRANSFER_TOKEN_INVALID', async () => {
    const db = makeDb([[]]);
    await expect(
      activateGift('bad-token', USER_ID, db)
    ).rejects.toThrow(PackageError);

    try {
      const db2 = makeDb([[]]);
      await activateGift('bad-token', USER_ID, db2);
    } catch (err) {
      expect((err as PackageError).code).toBe('TRANSFER_TOKEN_INVALID');
    }
  });
});

// ---------------------------------------------------------------------------
// Usage service — edge cases
// ---------------------------------------------------------------------------

describe('redeemItem — cancelled purchase', () => {
  it('throws PURCHASE_CANCELLED', async () => {
    const db = makeDb([
      [{ id: PURCHASE_ID, status: 'cancelled', expires_at: null, package_id: PACKAGE_ID }],
    ]);

    await expect(
      redeemItem(PURCHASE_ID, ITEM_ID, null, 1, USER_ID, db)
    ).rejects.toThrow(PackageError);

    try {
      const db2 = makeDb([
        [{ id: PURCHASE_ID, status: 'cancelled', expires_at: null, package_id: PACKAGE_ID }],
      ]);
      await redeemItem(PURCHASE_ID, ITEM_ID, null, 1, USER_ID, db2);
    } catch (err) {
      expect((err as PackageError).code).toBe('PURCHASE_CANCELLED');
    }
  });
});

describe('redeemItem — fully used purchase', () => {
  it('throws PURCHASE_FULLY_USED', async () => {
    const db = makeDb([
      [{ id: PURCHASE_ID, status: 'fully_used', expires_at: null, package_id: PACKAGE_ID }],
    ]);

    await expect(
      redeemItem(PURCHASE_ID, ITEM_ID, null, 1, USER_ID, db)
    ).rejects.toThrow(PackageError);

    try {
      const db2 = makeDb([
        [{ id: PURCHASE_ID, status: 'fully_used', expires_at: null, package_id: PACKAGE_ID }],
      ]);
      await redeemItem(PURCHASE_ID, ITEM_ID, null, 1, USER_ID, db2);
    } catch (err) {
      expect((err as PackageError).code).toBe('PURCHASE_FULLY_USED');
    }
  });
});

describe('redeemItem — purchase not found', () => {
  it('throws PURCHASE_NOT_FOUND', async () => {
    const db = makeDb([[]]);

    await expect(
      redeemItem('nonexistent', ITEM_ID, null, 1, USER_ID, db)
    ).rejects.toThrow(PackageError);

    try {
      const db2 = makeDb([[]]);
      await redeemItem('nonexistent', ITEM_ID, null, 1, USER_ID, db2);
    } catch (err) {
      expect((err as PackageError).code).toBe('PURCHASE_NOT_FOUND');
    }
  });
});

describe('redeemItem — item not found', () => {
  it('throws ITEM_NOT_FOUND', async () => {
    const db = makeDb([
      [{ id: PURCHASE_ID, status: 'active', expires_at: null, package_id: PACKAGE_ID }],
      [], // item not found
    ]);

    await expect(
      redeemItem(PURCHASE_ID, 'nonexistent', null, 1, USER_ID, db)
    ).rejects.toThrow(PackageError);

    try {
      const db2 = makeDb([
        [{ id: PURCHASE_ID, status: 'active', expires_at: null, package_id: PACKAGE_ID }],
        [],
      ]);
      await redeemItem(PURCHASE_ID, 'nonexistent', null, 1, USER_ID, db2);
    } catch (err) {
      expect((err as PackageError).code).toBe('ITEM_NOT_FOUND');
    }
  });
});

describe('redeemItem — transferred purchase', () => {
  it('throws PURCHASE_EXPIRED for non-active status', async () => {
    const db = makeDb([
      [{ id: PURCHASE_ID, status: 'transferred', expires_at: null, package_id: PACKAGE_ID }],
    ]);

    await expect(
      redeemItem(PURCHASE_ID, ITEM_ID, null, 1, USER_ID, db)
    ).rejects.toThrow(PackageError);

    try {
      const db2 = makeDb([
        [{ id: PURCHASE_ID, status: 'transferred', expires_at: null, package_id: PACKAGE_ID }],
      ]);
      await redeemItem(PURCHASE_ID, ITEM_ID, null, 1, USER_ID, db2);
    } catch (err) {
      expect((err as PackageError).code).toBe('PURCHASE_EXPIRED');
    }
  });
});

describe('redeemCredit — purchase not found', () => {
  it('throws PURCHASE_NOT_FOUND when no credit balance', async () => {
    const db = makeDb([[]]);

    await expect(
      redeemCredit('nonexistent', 100, null, USER_ID, db)
    ).rejects.toThrow(PackageError);

    try {
      const db2 = makeDb([[]]);
      await redeemCredit('nonexistent', 100, null, USER_ID, db2);
    } catch (err) {
      expect((err as PackageError).code).toBe('PURCHASE_NOT_FOUND');
    }
  });
});

describe('getUsageForPurchase — empty', () => {
  it('returns empty array when no usage records', async () => {
    const db = makeDb([[]]);
    const usages = await getUsageForPurchase(PURCHASE_ID, db);
    expect(usages).toEqual([]);
  });
});

describe('getRemainingQuota — item not found', () => {
  it('throws ITEM_NOT_FOUND', async () => {
    const db = makeDb([[]]);
    await expect(
      getRemainingQuota(PURCHASE_ID, 'nonexistent', db)
    ).rejects.toThrow(PackageError);

    try {
      const db2 = makeDb([[]]);
      await getRemainingQuota(PURCHASE_ID, 'nonexistent', db2);
    } catch (err) {
      expect((err as PackageError).code).toBe('ITEM_NOT_FOUND');
    }
  });
});

// ---------------------------------------------------------------------------
// Gift service — edge cases
// ---------------------------------------------------------------------------

describe('createGiftPackage — package not found', () => {
  it('throws PACKAGE_NOT_FOUND', async () => {
    const db = makeDb([[]]);
    await expect(
      createGiftPackage('nonexistent', USER_ID, null, 'Hi', db)
    ).rejects.toThrow(PackageError);

    try {
      const db2 = makeDb([[]]);
      await createGiftPackage('nonexistent', USER_ID, null, 'Hi', db2);
    } catch (err) {
      expect((err as PackageError).code).toBe('PACKAGE_NOT_FOUND');
    }
  });
});

describe('createGiftPackage — inactive package', () => {
  it('throws PACKAGE_SALE_CLOSED', async () => {
    const inactive = { ...PACKAGE_DB_ROW, is_active: false };
    const db = makeDb([[inactive]]);

    await expect(
      createGiftPackage(PACKAGE_ID, USER_ID, null, 'Hi', db)
    ).rejects.toThrow(PackageError);

    try {
      const db2 = makeDb([[inactive]]);
      await createGiftPackage(PACKAGE_ID, USER_ID, null, 'Hi', db2);
    } catch (err) {
      expect((err as PackageError).code).toBe('PACKAGE_SALE_CLOSED');
    }
  });
});

describe('createGiftPackage — sold out', () => {
  it('throws PACKAGE_SOLD_OUT', async () => {
    const soldOut = { ...PACKAGE_DB_ROW, activations_sold: 100, max_activations: 100 };
    const db = makeDb([[soldOut]]);

    await expect(
      createGiftPackage(PACKAGE_ID, USER_ID, null, 'Hi', db)
    ).rejects.toThrow(PackageError);

    try {
      const db2 = makeDb([[soldOut]]);
      await createGiftPackage(PACKAGE_ID, USER_ID, null, 'Hi', db2);
    } catch (err) {
      expect((err as PackageError).code).toBe('PACKAGE_SOLD_OUT');
    }
  });
});

describe('createGiftPackage — sale window', () => {
  it('throws PACKAGE_SALE_CLOSED before sale_start', async () => {
    const future = new Date(Date.now() + 86400000 * 30).toISOString();
    const notYet = { ...PACKAGE_DB_ROW, sale_start: future };
    const db = makeDb([[notYet]]);

    await expect(
      createGiftPackage(PACKAGE_ID, USER_ID, null, 'Hi', db)
    ).rejects.toThrow(PackageError);
  });

  it('throws PACKAGE_SALE_CLOSED after sale_end', async () => {
    const ended = { ...PACKAGE_DB_ROW, sale_end: pastDate };
    const db = makeDb([[ended]]);

    await expect(
      createGiftPackage(PACKAGE_ID, USER_ID, null, 'Hi', db)
    ).rejects.toThrow(PackageError);
  });
});

describe('claimGift — invalid token', () => {
  it('throws TRANSFER_TOKEN_INVALID', async () => {
    const db = makeDb([[]]);
    await expect(
      claimGift('bad-token', USER_ID, db)
    ).rejects.toThrow(PackageError);

    try {
      const db2 = makeDb([[]]);
      await claimGift('bad-token', USER_ID, db2);
    } catch (err) {
      expect((err as PackageError).code).toBe('TRANSFER_TOKEN_INVALID');
    }
  });
});

describe('getGiftByToken — not found', () => {
  it('throws TRANSFER_TOKEN_INVALID', async () => {
    const db = makeDb([[]]);
    await expect(
      getGiftByToken('nonexistent', db)
    ).rejects.toThrow(PackageError);
  });
});

// ---------------------------------------------------------------------------
// Package types coverage
// ---------------------------------------------------------------------------

describe('Package types', () => {
  it('supports bundle type', async () => {
    const row = { ...PACKAGE_ROW, package_type: 'bundle' };
    const db = makeDb([[row]]);
    const pkg = await getPackage(PACKAGE_ID, db);
    expect(pkg.packageType).toBe('bundle');
  });

  it('supports series type', async () => {
    const row = { ...PACKAGE_ROW, package_type: 'series' };
    const db = makeDb([[row]]);
    const pkg = await getPackage(PACKAGE_ID, db);
    expect(pkg.packageType).toBe('series');
  });

  it('supports membership type', async () => {
    const row = { ...PACKAGE_ROW, package_type: 'membership' };
    const db = makeDb([[row]]);
    const pkg = await getPackage(PACKAGE_ID, db);
    expect(pkg.packageType).toBe('membership');
  });

  it('supports gift type', async () => {
    const row = { ...PACKAGE_ROW, package_type: 'gift' };
    const db = makeDb([[row]]);
    const pkg = await getPackage(PACKAGE_ID, db);
    expect(pkg.packageType).toBe('gift');
  });
});

// ---------------------------------------------------------------------------
// Item types coverage
// ---------------------------------------------------------------------------

describe('Item types', () => {
  const baseItem = {
    id: ITEM_ID,
    package_id: PACKAGE_ID,
    service_id: null,
    name: 'Test',
    description: null,
    quantity: 1,
    unit: 'session',
    sort_order: 0,
    metadata: {},
  };

  it('supports service item type', async () => {
    const db = makeDb([[{ ...baseItem, item_type: 'service' }]]);
    const items = await listItems(PACKAGE_ID, db);
    expect(items[0].itemType).toBe('service');
  });

  it('supports credit item type', async () => {
    const db = makeDb([[{ ...baseItem, item_type: 'credit' }]]);
    const items = await listItems(PACKAGE_ID, db);
    expect(items[0].itemType).toBe('credit');
  });

  it('supports access item type', async () => {
    const db = makeDb([[{ ...baseItem, item_type: 'access' }]]);
    const items = await listItems(PACKAGE_ID, db);
    expect(items[0].itemType).toBe('access');
  });

  it('supports custom item type', async () => {
    const db = makeDb([[{ ...baseItem, item_type: 'custom' }]]);
    const items = await listItems(PACKAGE_ID, db);
    expect(items[0].itemType).toBe('custom');
  });
});

// ---------------------------------------------------------------------------
// Metadata handling
// ---------------------------------------------------------------------------

describe('Item metadata', () => {
  it('preserves complex metadata in addItem', async () => {
    const row = {
      id: ITEM_ID,
      package_id: PACKAGE_ID,
      service_id: null,
      item_type: 'custom' as const,
      name: 'Custom Item',
      description: null,
      quantity: 1,
      unit: 'piece',
      sort_order: 0,
      metadata: { color: 'red', size: 'L', tags: ['vip', 'premium'] },
    };
    const db = makeDb([[row]]);
    const item = await addItem(PACKAGE_ID, {
      itemType: 'custom',
      name: 'Custom Item',
      metadata: { color: 'red', size: 'L', tags: ['vip', 'premium'] },
    }, db);

    expect(item.metadata).toEqual({ color: 'red', size: 'L', tags: ['vip', 'premium'] });
  });

  it('defaults metadata to empty object when null', async () => {
    const row = {
      id: ITEM_ID,
      package_id: PACKAGE_ID,
      service_id: null,
      item_type: 'service' as const,
      name: 'Test',
      description: null,
      quantity: 1,
      unit: 'session',
      sort_order: 0,
      metadata: null as unknown as Record<string, unknown>,
    };
    const db = makeDb([[row]]);
    const items = await listItems(PACKAGE_ID, db);
    expect(items[0].metadata).toEqual({});
  });
});
