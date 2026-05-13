import { describe, it, expect, vi } from 'vitest';
import {
  evaluateSegment,
  evaluateSegments,
  getSegmentSize,
  getSampleRecipients,
  type DbAdapter,
} from '../services/segmentation.service.js';
import type { SegmentRule } from '../lib/types.js';

// =============================================================================
// Test fixtures
// =============================================================================

const USER_ID = 'user-001';
const PROMOTER_ID = 'promoter-001';

function makeDb(queryResults: unknown[][] = []): DbAdapter {
  let callIdx = 0;
  return {
    query: vi.fn(async () => {
      const result = queryResults[callIdx] ?? [];
      callIdx++;
      return result;
    }),
    execute: vi.fn(),
    transaction: vi.fn(async (fn) => fn({
      query: vi.fn(async () => {
        if (callIdx < queryResults.length) return queryResults[callIdx++];
        return [];
      }),
      execute: vi.fn(),
      transaction: vi.fn(),
    } as DbAdapter)),
  };
}

// =============================================================================
// Tests: Single segment evaluation
// =============================================================================

describe('evaluateSegment', () => {
  describe('event_type', () => {
    it('returns true if user attended event type', async () => {
      const db = makeDb([
        [{ count: 1 }],
      ]);

      const result = await evaluateSegment(
        USER_ID,
        { type: 'event_type', operator: 'equals', values: ['concert'] },
        db,
      );

      expect(result).toBe(true);
    });

    it('returns false if user never attended event type', async () => {
      const db = makeDb([
        [{ count: 0 }],
      ]);

      const result = await evaluateSegment(
        USER_ID,
        { type: 'event_type', operator: 'equals', values: ['concert'] },
        db,
      );

      expect(result).toBe(false);
    });
  });

  describe('geography', () => {
    it('returns true if user city matches', async () => {
      const db = makeDb([
        [{ city: 'Prague' }],
      ]);

      const result = await evaluateSegment(
        USER_ID,
        { type: 'geography', operator: 'equals', values: ['Prague'] },
        db,
      );

      expect(result).toBe(true);
    });

    it('returns false if user city does not match', async () => {
      const db = makeDb([
        [{ city: 'Prague' }],
      ]);

      const result = await evaluateSegment(
        USER_ID,
        { type: 'geography', operator: 'equals', values: ['Brno'] },
        db,
      );

      expect(result).toBe(false);
    });

    it('returns false if user has no city', async () => {
      const db = makeDb([
        [{ city: null }],
      ]);

      const result = await evaluateSegment(
        USER_ID,
        { type: 'geography', operator: 'equals', values: ['Prague'] },
        db,
      );

      expect(result).toBe(false);
    });
  });

  describe('age', () => {
    it('returns true if user age falls in bucket 18-25', async () => {
      const db = makeDb([
        [{ date_of_birth: '2008-04-18' }], // 18 years old
      ]);

      const result = await evaluateSegment(
        USER_ID,
        { type: 'age', operator: 'equals', values: ['18-25'] },
        db,
      );

      expect(result).toBe(true);
    });

    it('returns true if user age falls in bucket 26-40', async () => {
      const db = makeDb([
        [{ date_of_birth: '1990-04-18' }], // 35 years old
      ]);

      const result = await evaluateSegment(
        USER_ID,
        { type: 'age', operator: 'equals', values: ['26-40'] },
        db,
      );

      expect(result).toBe(true);
    });

    it('returns true if user age falls in bucket 40+', async () => {
      const db = makeDb([
        [{ date_of_birth: '1980-04-18' }], // 45 years old
      ]);

      const result = await evaluateSegment(
        USER_ID,
        { type: 'age', operator: 'equals', values: ['40+'] },
        db,
      );

      expect(result).toBe(true);
    });

    it('returns false if user age does not match bucket', async () => {
      const db = makeDb([
        [{ date_of_birth: '1980-04-18' }], // 45 years old
      ]);

      const result = await evaluateSegment(
        USER_ID,
        { type: 'age', operator: 'equals', values: ['18-25'] },
        db,
      );

      expect(result).toBe(false);
    });

    it('returns false if user has no date of birth', async () => {
      const db = makeDb([
        [{ date_of_birth: null }],
      ]);

      const result = await evaluateSegment(
        USER_ID,
        { type: 'age', operator: 'equals', values: ['18-25'] },
        db,
      );

      expect(result).toBe(false);
    });
  });

  describe('purchase_history', () => {
    it('returns true for high spender (>5000 CZK)', async () => {
      const db = makeDb([
        [{ total: 6000 }],
      ]);

      const result = await evaluateSegment(
        USER_ID,
        { type: 'purchase_history', operator: 'equals', values: ['high_spender'] },
        db,
      );

      expect(result).toBe(true);
    });

    it('returns false for low spender', async () => {
      const db = makeDb([
        [{ total: 2000 }],
      ]);

      const result = await evaluateSegment(
        USER_ID,
        { type: 'purchase_history', operator: 'equals', values: ['high_spender'] },
        db,
      );

      expect(result).toBe(false);
    });

    it('returns true for repeat buyer (2+ orders)', async () => {
      const db = makeDb([
        [{ count: 3 }],
      ]);

      const result = await evaluateSegment(
        USER_ID,
        { type: 'purchase_history', operator: 'equals', values: ['repeat'] },
        db,
      );

      expect(result).toBe(true);
    });

    it('returns true for one_time buyer', async () => {
      const db = makeDb([
        [{ count: 1 }],
      ]);

      const result = await evaluateSegment(
        USER_ID,
        { type: 'purchase_history', operator: 'equals', values: ['one_time'] },
        db,
      );

      expect(result).toBe(true);
    });

    it('returns true for inactive (180+ days)', async () => {
      const db = makeDb([
        [{ days_since: 200 }],
      ]);

      const result = await evaluateSegment(
        USER_ID,
        { type: 'purchase_history', operator: 'equals', values: ['inactive'] },
        db,
      );

      expect(result).toBe(true);
    });

    it('returns false for recently active', async () => {
      const db = makeDb([
        [{ days_since: 30 }],
      ]);

      const result = await evaluateSegment(
        USER_ID,
        { type: 'purchase_history', operator: 'equals', values: ['inactive'] },
        db,
      );

      expect(result).toBe(false);
    });
  });

  describe('engagement_level', () => {
    it('returns true if user has engagement type', async () => {
      const db = makeDb([
        [{ count: 1 }],
      ]);

      const result = await evaluateSegment(
        USER_ID,
        { type: 'engagement_level', operator: 'equals', values: ['opened_email'] },
        db,
      );

      expect(result).toBe(true);
    });

    it('returns false if user lacks engagement type', async () => {
      const db = makeDb([
        [{ count: 0 }],
      ]);

      const result = await evaluateSegment(
        USER_ID,
        { type: 'engagement_level', operator: 'equals', values: ['referred_friend'] },
        db,
      );

      expect(result).toBe(false);
    });
  });
});

// =============================================================================
// Tests: Multiple segment evaluation (AND logic)
// =============================================================================

describe('evaluateSegments', () => {
  it('returns true if user matches all rules', async () => {
    const db = makeDb([
      [{ count: 1 }], // event_type check
      [{ city: 'Prague' }], // geography check
    ]);

    const rules: SegmentRule[] = [
      { type: 'event_type', operator: 'equals', values: ['concert'] },
      { type: 'geography', operator: 'equals', values: ['Prague'] },
    ];

    const result = await evaluateSegments(USER_ID, rules, db);

    expect(result).toBe(true);
  });

  it('returns false if user fails any rule (AND logic)', async () => {
    const db = makeDb([
      [{ count: 1 }], // event_type passes
      [{ city: 'Prague' }], // geography check returns Prague
      // Third rule will fail
    ]);

    const rules: SegmentRule[] = [
      { type: 'event_type', operator: 'equals', values: ['concert'] },
      { type: 'geography', operator: 'equals', values: ['Brno'] }, // Mismatch
    ];

    const result = await evaluateSegments(USER_ID, rules, db);

    expect(result).toBe(false);
  });

  it('returns true for empty rules (no filtering)', async () => {
    const db = makeDb([]);

    const result = await evaluateSegments(USER_ID, [], db);

    expect(result).toBe(true);
  });

  it('fails fast on first non-matching rule', async () => {
    const db = makeDb([
      [{ count: 0 }], // event_type fails immediately
    ]);

    const rules: SegmentRule[] = [
      { type: 'event_type', operator: 'equals', values: ['concert'] },
      { type: 'geography', operator: 'equals', values: ['Prague'] },
    ];

    const result = await evaluateSegments(USER_ID, rules, db);

    expect(result).toBe(false);
    // Should only have called query once (for event_type)
    expect((db.query as any).mock.calls).toHaveLength(1);
  });
});

// =============================================================================
// Tests: Segment size estimation
// =============================================================================

describe('getSegmentSize', () => {
  it('returns count of matching users', async () => {
    const db = makeDb([
      [{ count: 42 }],
    ]);

    const size = await getSegmentSize(PROMOTER_ID, [], db);

    expect(size).toBe(42);
  });

  it('returns 0 for no matches', async () => {
    const db = makeDb([
      [{ count: 0 }],
    ]);

    const size = await getSegmentSize(PROMOTER_ID, [], db);

    expect(size).toBe(0);
  });

  it('filters by event_type when rule provided', async () => {
    const db = makeDb([
      [{ count: 15 }],
    ]);

    const rules: SegmentRule[] = [
      { type: 'event_type', operator: 'equals', values: ['concert'] },
    ];

    await getSegmentSize(PROMOTER_ID, rules, db);

    const query = (db.query as any).mock.calls[0][0];
    expect(query).toContain('event_type');
  });

  it('filters by geography when rule provided', async () => {
    const db = makeDb([
      [{ count: 8 }],
    ]);

    const rules: SegmentRule[] = [
      { type: 'geography', operator: 'equals', values: ['Prague'] },
    ];

    await getSegmentSize(PROMOTER_ID, rules, db);

    const query = (db.query as any).mock.calls[0][0];
    expect(query).toContain('city');
  });
});

// =============================================================================
// Tests: Sample recipients
// =============================================================================

describe('getSampleRecipients', () => {
  it('returns up to N sample recipients', async () => {
    const db = makeDb([
      [
        { user_id: 'user-001', phone: '+420722123456', event_type: 'concert', last_purchase_date: '2026-04-15' },
        { user_id: 'user-002', phone: '+420722123457', event_type: 'festival', last_purchase_date: '2026-04-14' },
        { user_id: 'user-003', phone: '+420722123458', event_type: 'concert', last_purchase_date: '2026-04-10' },
      ],
    ]);

    const samples = await getSampleRecipients(PROMOTER_ID, [], db, 3);

    expect(samples).toHaveLength(3);
    expect(samples[0].userId).toBe('user-001');
    expect(samples[0].phone).toBe('+420722123456');
  });

  it('returns fewer than limit if fewer available', async () => {
    const db = makeDb([
      [
        { user_id: 'user-001', phone: '+420722123456', event_type: 'concert', last_purchase_date: '2026-04-15' },
      ],
    ]);

    const samples = await getSampleRecipients(PROMOTER_ID, [], db, 10);

    expect(samples).toHaveLength(1);
  });

  it('orders by most recent purchase', async () => {
    const db = makeDb([
      [
        { user_id: 'user-002', phone: '+420722123457', event_type: 'festival', last_purchase_date: '2026-04-20' },
        { user_id: 'user-003', phone: '+420722123458', event_type: 'concert', last_purchase_date: '2026-04-15' },
        { user_id: 'user-001', phone: '+420722123456', event_type: 'concert', last_purchase_date: '2026-04-10' },
      ],
    ]);

    const samples = await getSampleRecipients(PROMOTER_ID, [], db, 3);

    // Should be ordered by last_purchase_date DESC (most recent first)
    expect(samples[0].lastPurchaseDate).toBe('2026-04-20');
    expect(samples[1].lastPurchaseDate).toBe('2026-04-15');
  });

  it('handles users with no purchase date', async () => {
    const db = makeDb([
      [
        { user_id: 'user-001', phone: '+420722123456', event_type: 'concert', last_purchase_date: null },
      ],
    ]);

    const samples = await getSampleRecipients(PROMOTER_ID, [], db, 3);

    expect(samples[0].lastPurchaseDate).toBeUndefined();
  });
});
