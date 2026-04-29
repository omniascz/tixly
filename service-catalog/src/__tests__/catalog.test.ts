import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CatalogError, isCatalogError } from '../lib/catalog-errors';
import {
  createCategory,
  getCategory,
  listCategories,
  updateCategory,
  deleteCategory,
} from '../services/category.service';
import {
  createService,
  getService,
  listServices,
  updateService,
  searchServices,
  linkResource,
  unlinkResource,
  featureService,
  unfeatureService,
} from '../services/service.service';
import {
  createAddon,
  listAddons,
  updateAddon,
  deleteAddon,
} from '../services/addon.service';
import {
  createPricingRule,
  listPricingRules,
  calculatePrice,
} from '../services/pricing.service';
import {
  createReview,
  getReviews,
  getAverageRating,
} from '../services/review.service';

// ---------------------------------------------------------------------------
// makeDb helper — query() increments index; execute() does NOT
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
const CATEGORY_ID = 'category-uuid-0001';
const SERVICE_ID = 'service-uuid-0001';
const ADDON_ID = 'addon-uuid-0001';
const RULE_ID = 'rule-uuid-0001';
const REVIEW_ID = 'review-uuid-0001';
const USER_ID = 'user-uuid-0001';
const RESOURCE_ID = 'resource-uuid-0001';
const BOOKING_ID = 'booking-uuid-0001';

const CATEGORY_ROW = {
  id: CATEGORY_ID,
  promoter_id: PROMOTER_ID,
  name: 'Tennis',
  slug: 'tennis',
  description: 'Tennis courts and lessons',
  icon: 'tennis',
  color: '#6366f1',
  sort_order: 1,
  is_active: true,
  created_at: '2026-04-07T10:00:00.000Z',
};

const CATEGORY_WITH_COUNT_ROW = {
  ...CATEGORY_ROW,
  service_count: '3',
};

const SERVICE_ROW = {
  id: SERVICE_ID,
  promoter_id: PROMOTER_ID,
  branch_id: null,
  category_id: CATEGORY_ID,
  category_name: 'Tennis',
  name: '60min Tennis Court Rental',
  slug: '60min-tennis-court-rental',
  short_description: 'Rent a tennis court for 60 minutes',
  description: 'Full court rental including balls',
  duration_minutes: 60,
  capacity_min: 1,
  capacity_max: 4,
  price_hellers: 50000,
  price_type: 'fixed' as const,
  requires_resource: true,
  resource_type: 'tennis_court',
  cancellation_hours: 24,
  booking_window_days: 30,
  min_advance_hours: 1,
  images: [],
  tags: ['sport', 'outdoor'],
  metadata: {},
  is_active: true,
  is_featured: false,
  created_at: '2026-04-07T10:00:00.000Z',
  updated_at: '2026-04-07T10:00:00.000Z',
  avg_rating: '4.50',
  review_count: '12',
};

const ADDON_ROW = {
  id: ADDON_ID,
  service_id: SERVICE_ID,
  name: 'Racket Rental',
  description: 'Rent a tennis racket',
  price_hellers: 5000,
  max_quantity: 4,
  is_required: false,
  is_active: true,
  sort_order: 0,
};

const PRICING_RULE_ROW = {
  id: RULE_ID,
  service_id: SERVICE_ID,
  name: 'Weekend Peak',
  rule_type: 'weekend' as const,
  price_modifier_type: 'percentage' as const,
  price_modifier_value: 2000, // 20% in basis points
  day_of_week: [0, 6],
  time_from: null,
  time_to: null,
  min_quantity: null,
  advance_hours_min: null,
  advance_hours_max: null,
  is_active: true,
  priority: 10,
};

const REVIEW_ROW = {
  id: REVIEW_ID,
  service_id: SERVICE_ID,
  user_id: USER_ID,
  booking_id: BOOKING_ID,
  rating: 5,
  title: 'Great court!',
  body: 'The court was in perfect condition.',
  is_verified: true,
  created_at: '2026-04-07T10:00:00.000Z',
};

// ---------------------------------------------------------------------------
// Tests: Categories
// ---------------------------------------------------------------------------

describe('createCategory', () => {
  it('1. creates a category with auto-generated slug from name', async () => {
    const db = makeDb([[CATEGORY_ROW]]);
    const category = await createCategory(PROMOTER_ID, { name: 'Tennis' }, db);

    expect(category.id).toBe(CATEGORY_ID);
    expect(category.promoterId).toBe(PROMOTER_ID);
    expect(category.name).toBe('Tennis');
    expect(category.slug).toBe('tennis');
    expect(category.color).toBe('#6366f1');
    expect(db.query).toHaveBeenCalledTimes(1);
    // Verify slug was auto-generated from name
    const callArgs = db.query.mock.calls[0];
    expect(callArgs[1]).toContain('tennis'); // slug param
  });

  it('2. createCategory — duplicate slug → CATEGORY_DUPLICATE', async () => {
    const db = makeDb([[]]);
    await expect(createCategory(PROMOTER_ID, { name: 'Tennis' }, db)).rejects.toThrow(CatalogError);

    try {
      const db2 = makeDb([[]]);
      await createCategory(PROMOTER_ID, { name: 'Tennis' }, db2);
    } catch (err) {
      expect(isCatalogError(err)).toBe(true);
      expect((err as CatalogError).code).toBe('CATEGORY_DUPLICATE');
    }
  });
});

describe('getCategory', () => {
  it('3. getCategory — with service count', async () => {
    const db = makeDb([[CATEGORY_WITH_COUNT_ROW]]);
    const category = await getCategory(CATEGORY_ID, db);

    expect(category.id).toBe(CATEGORY_ID);
    expect(category.serviceCount).toBe(3);
    expect(db.query).toHaveBeenCalledTimes(1);
  });
});

describe('listCategories', () => {
  it('4. listCategories — ordered by sort_order', async () => {
    const cat1 = { ...CATEGORY_ROW, id: 'cat-1', sort_order: 1 };
    const cat2 = { ...CATEGORY_ROW, id: 'cat-2', sort_order: 2 };
    const db = makeDb([[cat1, cat2]]);
    const categories = await listCategories(PROMOTER_ID, db);

    expect(Array.isArray(categories)).toBe(true);
    expect(categories).toHaveLength(2);
    expect(categories[0].id).toBe('cat-1');
    expect(categories[1].id).toBe('cat-2');
    // Verify query uses ORDER BY sort_order
    expect(db.query.mock.calls[0][0]).toContain('sort_order');
  });
});

describe('updateCategory', () => {
  it('5. updateCategory — partial update', async () => {
    const updated = { ...CATEGORY_ROW, name: 'Tennis & Padel', icon: 'racket' };
    const db = makeDb([[updated]]);
    const category = await updateCategory(CATEGORY_ID, { name: 'Tennis & Padel', icon: 'racket' }, db);

    expect(category.name).toBe('Tennis & Padel');
    expect(category.icon).toBe('racket');
  });
});

describe('deleteCategory', () => {
  it('6. deleteCategory — soft delete if has services', async () => {
    // Query 1: count returns 2 services
    const db = makeDb([[{ cnt: '2' }]]);
    const result = await deleteCategory(CATEGORY_ID, db);

    expect(result.softDeleted).toBe(true);
    expect(result.deleted).toBe(false);
    expect(db.execute).toHaveBeenCalledTimes(1);
    expect(db.execute.mock.calls[0][0]).toContain('is_active = false');
  });

  it('6b. deleteCategory — hard delete if no services', async () => {
    const db = makeDb([[{ cnt: '0' }]]);
    const result = await deleteCategory(CATEGORY_ID, db);

    expect(result.deleted).toBe(true);
    expect(result.softDeleted).toBe(false);
    expect(db.execute).toHaveBeenCalledTimes(1);
    expect(db.execute.mock.calls[0][0]).toContain('DELETE FROM');
  });
});

// ---------------------------------------------------------------------------
// Tests: Services
// ---------------------------------------------------------------------------

describe('createService', () => {
  it('7. createService — valid', async () => {
    const db = makeDb([[SERVICE_ROW]]);
    const service = await createService(PROMOTER_ID, {
      name: '60min Tennis Court Rental',
      durationMinutes: 60,
      priceHellers: 50000,
      capacityMax: 4,
    }, db);

    expect(service.id).toBe(SERVICE_ID);
    expect(service.promoterId).toBe(PROMOTER_ID);
    expect(service.name).toBe('60min Tennis Court Rental');
    expect(service.durationMinutes).toBe(60);
    expect(service.priceHellers).toBe(50000);
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  it('8. createService — duplicate slug → SERVICE_DUPLICATE', async () => {
    const db = makeDb([[]]);
    await expect(
      createService(PROMOTER_ID, { name: '60min Tennis Court Rental', durationMinutes: 60 }, db)
    ).rejects.toThrow(CatalogError);

    try {
      const db2 = makeDb([[]]);
      await createService(PROMOTER_ID, { name: '60min Tennis Court Rental', durationMinutes: 60 }, db2);
    } catch (err) {
      expect((err as CatalogError).code).toBe('SERVICE_DUPLICATE');
    }
  });
});

describe('getService', () => {
  it('9. getService — with addons + avg_rating', async () => {
    const db = makeDb([[SERVICE_ROW], [ADDON_ROW]]);
    const service = await getService(SERVICE_ID, db);

    expect(service.id).toBe(SERVICE_ID);
    expect(service.avgRating).toBe(4.5);
    expect(service.reviewCount).toBe(12);
    expect(service.addons).toHaveLength(1);
    expect(service.addons![0].name).toBe('Racket Rental');
    expect(db.query).toHaveBeenCalledTimes(2);
  });
});

describe('listServices', () => {
  it('10. listServices — filter by category_id', async () => {
    const db = makeDb([[SERVICE_ROW]]);
    const services = await listServices(PROMOTER_ID, { categoryId: CATEGORY_ID }, db);

    expect(services).toHaveLength(1);
    expect(services[0].categoryId).toBe(CATEGORY_ID);
    const sql = db.query.mock.calls[0][0] as string;
    expect(sql).toContain('category_id');
  });

  it('11. listServices — filter by is_featured', async () => {
    const featuredRow = { ...SERVICE_ROW, is_featured: true };
    const db = makeDb([[featuredRow]]);
    const services = await listServices(PROMOTER_ID, { isFeatured: true }, db);

    expect(services).toHaveLength(1);
    const sql = db.query.mock.calls[0][0] as string;
    expect(sql).toContain('is_featured');
  });

  it('12. listServices — filter by tags', async () => {
    const db = makeDb([[SERVICE_ROW]]);
    const services = await listServices(PROMOTER_ID, { tags: ['sport'] }, db);

    expect(services).toHaveLength(1);
    const sql = db.query.mock.calls[0][0] as string;
    expect(sql).toContain('tags');
  });
});

describe('updateService', () => {
  it('13. updateService — sets updated_at', async () => {
    const updatedRow = { ...SERVICE_ROW, price_hellers: 60000, updated_at: '2026-04-07T12:00:00.000Z' };
    const db = makeDb([[updatedRow]]);
    const service = await updateService(SERVICE_ID, { priceHellers: 60000 }, db);

    expect(service.priceHellers).toBe(60000);
    // Verify SQL includes updated_at = NOW()
    const sql = db.query.mock.calls[0][0] as string;
    expect(sql).toContain('updated_at');
  });
});

describe('searchServices', () => {
  it('14. searchServices — returns ILIKE matches', async () => {
    const db = makeDb([[SERVICE_ROW]]);
    const services = await searchServices(PROMOTER_ID, 'tennis', db);

    expect(services).toHaveLength(1);
    expect(services[0].name).toContain('Tennis');
    const sql = db.query.mock.calls[0][0] as string;
    expect(sql).toContain('ILIKE');
  });
});

describe('linkResource', () => {
  it('15. linkResource — valid', async () => {
    const linkRow = { service_id: SERVICE_ID, resource_id: RESOURCE_ID, is_primary: true };
    const db = makeDb([[linkRow]]);
    const link = await linkResource(SERVICE_ID, RESOURCE_ID, true, db);

    expect(link.serviceId).toBe(SERVICE_ID);
    expect(link.resourceId).toBe(RESOURCE_ID);
    expect(link.isPrimary).toBe(true);
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  it('16. linkResource — duplicate → RESOURCE_LINK_EXISTS', async () => {
    const db = makeDb([[]]);
    await expect(linkResource(SERVICE_ID, RESOURCE_ID, true, db)).rejects.toThrow(CatalogError);

    try {
      const db2 = makeDb([[]]);
      await linkResource(SERVICE_ID, RESOURCE_ID, true, db2);
    } catch (err) {
      expect((err as CatalogError).code).toBe('RESOURCE_LINK_EXISTS');
    }
  });
});

describe('unlinkResource', () => {
  it('17. unlinkResource — removes link', async () => {
    const db = makeDb();
    await unlinkResource(SERVICE_ID, RESOURCE_ID, db);

    expect(db.execute).toHaveBeenCalledTimes(1);
    expect(db.execute.mock.calls[0][0]).toContain('DELETE FROM reservations.service_resources');
  });
});

describe('featureService / unfeatureService', () => {
  it('18a. featureService — sets is_featured=true', async () => {
    const db = makeDb();
    await featureService(SERVICE_ID, db);

    expect(db.execute).toHaveBeenCalledTimes(1);
    expect(db.execute.mock.calls[0][0]).toContain('is_featured = true');
  });

  it('18b. unfeatureService — sets is_featured=false', async () => {
    const db = makeDb();
    await unfeatureService(SERVICE_ID, db);

    expect(db.execute).toHaveBeenCalledTimes(1);
    expect(db.execute.mock.calls[0][0]).toContain('is_featured = false');
  });
});

// ---------------------------------------------------------------------------
// Tests: Addons
// ---------------------------------------------------------------------------

describe('createAddon', () => {
  it('19. createAddon — valid', async () => {
    const db = makeDb([[ADDON_ROW]]);
    const addon = await createAddon(SERVICE_ID, {
      name: 'Racket Rental',
      priceHellers: 5000,
    }, db);

    expect(addon.id).toBe(ADDON_ID);
    expect(addon.serviceId).toBe(SERVICE_ID);
    expect(addon.name).toBe('Racket Rental');
    expect(addon.priceHellers).toBe(5000);
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  it('20. createAddon — duplicate → ADDON_DUPLICATE', async () => {
    const db = makeDb([[]]);
    await expect(createAddon(SERVICE_ID, { name: 'Racket Rental' }, db)).rejects.toThrow(CatalogError);

    try {
      const db2 = makeDb([[]]);
      await createAddon(SERVICE_ID, { name: 'Racket Rental' }, db2);
    } catch (err) {
      expect((err as CatalogError).code).toBe('ADDON_DUPLICATE');
    }
  });
});

describe('listAddons', () => {
  it('21. listAddons — ordered by sort_order', async () => {
    const addon1 = { ...ADDON_ROW, id: 'a-1', name: 'Balls', sort_order: 0 };
    const addon2 = { ...ADDON_ROW, id: 'a-2', name: 'Racket', sort_order: 1 };
    const db = makeDb([[addon1, addon2]]);
    const addons = await listAddons(SERVICE_ID, db);

    expect(addons).toHaveLength(2);
    expect(addons[0].id).toBe('a-1');
    expect(addons[1].id).toBe('a-2');
    const sql = db.query.mock.calls[0][0] as string;
    expect(sql).toContain('sort_order');
  });
});

describe('updateAddon', () => {
  it('22. updateAddon — partial update', async () => {
    const updated = { ...ADDON_ROW, price_hellers: 7500, max_quantity: 2 };
    const db = makeDb([[updated]]);
    const addon = await updateAddon(ADDON_ID, { priceHellers: 7500, maxQuantity: 2 }, db);

    expect(addon.priceHellers).toBe(7500);
    expect(addon.maxQuantity).toBe(2);
  });
});

describe('deleteAddon', () => {
  it('23. deleteAddon — calls delete', async () => {
    const db = makeDb();
    await deleteAddon(ADDON_ID, db);

    expect(db.execute).toHaveBeenCalledTimes(1);
    expect(db.execute.mock.calls[0][0]).toContain('DELETE FROM reservations.service_addons');
  });
});

// ---------------------------------------------------------------------------
// Tests: Pricing
// ---------------------------------------------------------------------------

describe('createPricingRule', () => {
  it('24. createPricingRule — percentage type', async () => {
    const db = makeDb([[PRICING_RULE_ROW]]);
    const rule = await createPricingRule(SERVICE_ID, {
      name: 'Weekend Peak',
      ruleType: 'weekend',
      priceModifierType: 'percentage',
      priceModifierValue: 2000,
      dayOfWeek: [0, 6],
      priority: 10,
    }, db);

    expect(rule.id).toBe(RULE_ID);
    expect(rule.priceModifierType).toBe('percentage');
    expect(rule.priceModifierValue).toBe(2000);
    expect(rule.dayOfWeek).toEqual([0, 6]);
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  it('25. createPricingRule — absolute type', async () => {
    const absoluteRow = {
      ...PRICING_RULE_ROW,
      id: 'rule-abs-001',
      name: 'Happy Hour',
      rule_type: 'off_peak' as const,
      price_modifier_type: 'absolute' as const,
      price_modifier_value: -10000, // -100 CZK discount
      day_of_week: null,
    };
    const db = makeDb([[absoluteRow]]);
    const rule = await createPricingRule(SERVICE_ID, {
      name: 'Happy Hour',
      ruleType: 'off_peak',
      priceModifierType: 'absolute',
      priceModifierValue: -10000,
    }, db);

    expect(rule.priceModifierType).toBe('absolute');
    expect(rule.priceModifierValue).toBe(-10000);
  });
});

describe('calculatePrice', () => {
  it('26. calculatePrice — no rules → base price unchanged', async () => {
    // Query 1: service price, Query 2: empty rules
    const db = makeDb([[{ price_hellers: 50000 }], []]);
    const result = await calculatePrice(SERVICE_ID, {}, db);

    expect(result.basePrice).toBe(50000);
    expect(result.finalPrice).toBe(50000);
    expect(result.appliedRules).toHaveLength(0);
    expect(db.query).toHaveBeenCalledTimes(2);
  });

  it('27. calculatePrice — percentage rule matches day_of_week → correct modifier', async () => {
    // Base price: 50000 halíře, +20% on weekend
    // Expected: 50000 * (1 + 2000/10000) = 50000 * 1.2 = 60000
    const db = makeDb([
      [{ price_hellers: 50000 }],
      [PRICING_RULE_ROW], // priority=10, weekend +20%
    ]);
    const result = await calculatePrice(SERVICE_ID, { dayOfWeek: 6 }, db); // Saturday

    expect(result.basePrice).toBe(50000);
    expect(result.finalPrice).toBe(60000);
    expect(result.appliedRules).toHaveLength(1);
    expect(result.appliedRules[0].name).toBe('Weekend Peak');
  });

  it('27b. calculatePrice — percentage rule does NOT match non-weekend day', async () => {
    // Monday (dayOfWeek=1) should not match weekend rule
    const db = makeDb([
      [{ price_hellers: 50000 }],
      [PRICING_RULE_ROW], // weekend rule
    ]);
    const result = await calculatePrice(SERVICE_ID, { dayOfWeek: 1 }, db); // Monday

    expect(result.finalPrice).toBe(50000);
    expect(result.appliedRules).toHaveLength(0);
  });

  it('28. calculatePrice — absolute rule → base + modifier', async () => {
    const absoluteRule = {
      ...PRICING_RULE_ROW,
      id: 'rule-abs',
      name: 'Discount',
      rule_type: 'off_peak' as const,
      price_modifier_type: 'absolute' as const,
      price_modifier_value: -5000, // -50 CZK
      day_of_week: null,
      advance_hours_min: null,
      advance_hours_max: null,
    };
    const db = makeDb([
      [{ price_hellers: 50000 }],
      [absoluteRule],
    ]);
    const result = await calculatePrice(SERVICE_ID, {}, db);

    expect(result.basePrice).toBe(50000);
    expect(result.finalPrice).toBe(45000); // 50000 - 5000
    expect(result.appliedRules).toHaveLength(1);
  });

  it('29. calculatePrice — fixed rule → replaces price', async () => {
    const fixedRule = {
      ...PRICING_RULE_ROW,
      id: 'rule-fixed',
      name: 'Member Flat Rate',
      rule_type: 'member' as const,
      price_modifier_type: 'fixed' as const,
      price_modifier_value: 30000, // fixed 300 CZK
      day_of_week: null,
      advance_hours_min: null,
      advance_hours_max: null,
    };
    const db = makeDb([
      [{ price_hellers: 50000 }],
      [fixedRule],
    ]);
    const result = await calculatePrice(SERVICE_ID, { isMember: true }, db);

    expect(result.basePrice).toBe(50000);
    expect(result.finalPrice).toBe(30000); // fixed replacement
    expect(result.appliedRules).toHaveLength(1);
    expect(result.appliedRules[0].name).toBe('Member Flat Rate');
  });

  it('30. calculatePrice — multiple rules → applied in priority order', async () => {
    // Rule 1 (priority=10): percentage +20% → 50000 * 1.2 = 60000
    // Rule 2 (priority=5): absolute -5000 → 60000 - 5000 = 55000
    const percentageRule = { ...PRICING_RULE_ROW, priority: 10, day_of_week: null };
    const absoluteRule = {
      ...PRICING_RULE_ROW,
      id: 'rule-abs',
      name: 'Discount',
      rule_type: 'off_peak' as const,
      price_modifier_type: 'absolute' as const,
      price_modifier_value: -5000,
      day_of_week: null,
      advance_hours_min: null,
      advance_hours_max: null,
      priority: 5,
    };

    const db = makeDb([
      [{ price_hellers: 50000 }],
      [percentageRule, absoluteRule], // already sorted by priority DESC
    ]);
    const result = await calculatePrice(SERVICE_ID, {}, db);

    expect(result.basePrice).toBe(50000);
    // percentage first: 50000 * 1.2 = 60000, then absolute: 60000 - 5000 = 55000
    expect(result.finalPrice).toBe(55000);
    expect(result.appliedRules).toHaveLength(2);
  });
});

describe('listPricingRules', () => {
  it('31. listPricingRules — ordered by priority DESC', async () => {
    const rule1 = { ...PRICING_RULE_ROW, id: 'r-1', name: 'High Priority', priority: 10 };
    const rule2 = { ...PRICING_RULE_ROW, id: 'r-2', name: 'Low Priority', priority: 1 };
    const db = makeDb([[rule1, rule2]]);
    const rules = await listPricingRules(SERVICE_ID, db);

    expect(rules).toHaveLength(2);
    expect(rules[0].priority).toBe(10);
    expect(rules[1].priority).toBe(1);
    const sql = db.query.mock.calls[0][0] as string;
    expect(sql).toContain('priority DESC');
  });
});

// ---------------------------------------------------------------------------
// Tests: Reviews
// ---------------------------------------------------------------------------

describe('createReview', () => {
  it('32. createReview — valid, is_verified=true when booking_id provided', async () => {
    const db = makeDb([[REVIEW_ROW]]);
    const review = await createReview(SERVICE_ID, USER_ID, {
      bookingId: BOOKING_ID,
      rating: 5,
      title: 'Great court!',
      body: 'The court was in perfect condition.',
    }, db);

    expect(review.id).toBe(REVIEW_ID);
    expect(review.serviceId).toBe(SERVICE_ID);
    expect(review.userId).toBe(USER_ID);
    expect(review.isVerified).toBe(true);
    expect(review.rating).toBe(5);
    expect(review.bookingId).toBe(BOOKING_ID);
    // Verify is_verified=true was passed to the query
    const callParams = db.query.mock.calls[0][1] as unknown[];
    expect(callParams).toContain(true); // is_verified
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  it('33. createReview — duplicate → REVIEW_DUPLICATE', async () => {
    const db = makeDb([[]]);
    await expect(
      createReview(SERVICE_ID, USER_ID, { rating: 4 }, db)
    ).rejects.toThrow(CatalogError);

    try {
      const db2 = makeDb([[]]);
      await createReview(SERVICE_ID, USER_ID, { rating: 4 }, db2);
    } catch (err) {
      expect((err as CatalogError).code).toBe('REVIEW_DUPLICATE');
    }
  });
});

describe('getReviews', () => {
  it('34. getReviews — filter by min_rating', async () => {
    const db = makeDb([[REVIEW_ROW]]);
    const reviews = await getReviews(SERVICE_ID, { minRating: 4 }, db);

    expect(reviews).toHaveLength(1);
    expect(reviews[0].rating).toBeGreaterThanOrEqual(4);
    const sql = db.query.mock.calls[0][0] as string;
    expect(sql).toContain('rating >=');
  });
});

describe('getAverageRating', () => {
  it('35. getAverageRating — returns avg + count', async () => {
    const db = makeDb([[{ avg_rating: '4.50', review_count: '12' }]]);
    const result = await getAverageRating(SERVICE_ID, db);

    expect(result.avgRating).toBe(4.5);
    expect(result.count).toBe(12);
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  it('35b. getAverageRating — returns null avg when no reviews', async () => {
    const db = makeDb([[{ avg_rating: null, review_count: '0' }]]);
    const result = await getAverageRating(SERVICE_ID, db);

    expect(result.avgRating).toBeNull();
    expect(result.count).toBe(0);
  });
});
