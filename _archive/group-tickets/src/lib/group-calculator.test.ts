/**
 * Unit tests for group-calculator.ts pure functions.
 * No DB or external dependencies — fully self-contained.
 *
 * Run with: vitest src/lib/group-calculator.test.ts
 */
import { describe, it, expect } from 'vitest';
import {
  validateGroupQuantity,
  calculateGroupTotal,
  validateMemberList,
  generateMemberPlaceholders,
  formatGroupSummary,
} from './group-calculator';
import type { GroupTicketType, GroupOrder } from '../types/group-ticket.types';
import {
  GroupQuantityError,
  GroupMemberListError,
} from '../types/group-ticket.types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeFixed(overrides?: Partial<GroupTicketType>): GroupTicketType {
  return {
    id: 'gtt-fixed-001',
    event_id: 'evt-001',
    name: 'Školní výlet (přesně 20 osob)',
    description: null,
    group_type: 'fixed',
    min_quantity: 20,
    max_quantity: 20,
    price_per_person: 25000, // 250 Kč
    total_quantity: 50,
    sold_count: 0,
    active: true,
    requires_member_list: false,
    ...overrides,
  };
}

function makeFlexible(overrides?: Partial<GroupTicketType>): GroupTicketType {
  return {
    id: 'gtt-flex-001',
    event_id: 'evt-001',
    name: 'Firemní večírek (10–30 osob)',
    description: null,
    group_type: 'flexible',
    min_quantity: 10,
    max_quantity: 30,
    price_per_person: 35000, // 350 Kč
    total_quantity: 20,
    sold_count: 0,
    active: true,
    requires_member_list: false,
    ...overrides,
  };
}

function makeOpen(overrides?: Partial<GroupTicketType>): GroupTicketType {
  return {
    id: 'gtt-open-001',
    event_id: 'evt-001',
    name: 'Firemní objednávka (min. 5 osob)',
    description: null,
    group_type: 'open',
    min_quantity: 5,
    max_quantity: null,
    price_per_person: 29900, // 299 Kč
    total_quantity: 100,
    sold_count: 0,
    active: true,
    requires_member_list: false,
    ...overrides,
  };
}

function makeOrder(overrides?: Partial<GroupOrder>): GroupOrder {
  return {
    id: 'go-001',
    group_ticket_type_id: 'gtt-flex-001',
    event_id: 'evt-001',
    leader_user_id: 'user-001',
    quantity: 15,
    price_per_person: 35000,
    total_amount: 525000, // 15 × 350 Kč = 5 250 Kč
    status: 'confirmed',
    members: [],
    ticket_ids: [],
    created_at: new Date('2026-04-04T10:00:00Z'),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// validateGroupQuantity — fixed group
// ---------------------------------------------------------------------------

describe('validateGroupQuantity — fixed group', () => {
  it('accepts the exact required quantity', () => {
    expect(() => validateGroupQuantity(makeFixed(), 20)).not.toThrow();
  });

  it('throws GroupQuantityError when quantity is less than required', () => {
    expect(() => validateGroupQuantity(makeFixed(), 19)).toThrow(GroupQuantityError);
  });

  it('throws GroupQuantityError when quantity is more than required', () => {
    expect(() => validateGroupQuantity(makeFixed(), 21)).toThrow(GroupQuantityError);
  });

  it('error message mentions correct fixed quantity', () => {
    try {
      validateGroupQuantity(makeFixed(), 5);
      expect.fail('should have thrown');
    } catch (err) {
      expect((err as GroupQuantityError).message).toContain('20');
    }
  });
});

// ---------------------------------------------------------------------------
// validateGroupQuantity — flexible group
// ---------------------------------------------------------------------------

describe('validateGroupQuantity — flexible group', () => {
  it('accepts quantity at the minimum boundary', () => {
    expect(() => validateGroupQuantity(makeFlexible(), 10)).not.toThrow();
  });

  it('accepts quantity at the maximum boundary', () => {
    expect(() => validateGroupQuantity(makeFlexible(), 30)).not.toThrow();
  });

  it('accepts quantity strictly within the range', () => {
    expect(() => validateGroupQuantity(makeFlexible(), 15)).not.toThrow();
  });

  it('throws GroupQuantityError when quantity is below min', () => {
    expect(() => validateGroupQuantity(makeFlexible(), 9)).toThrow(GroupQuantityError);
  });

  it('throws GroupQuantityError when quantity exceeds max', () => {
    expect(() => validateGroupQuantity(makeFlexible(), 31)).toThrow(GroupQuantityError);
  });
});

// ---------------------------------------------------------------------------
// validateGroupQuantity — open group
// ---------------------------------------------------------------------------

describe('validateGroupQuantity — open group', () => {
  it('accepts the minimum quantity', () => {
    expect(() => validateGroupQuantity(makeOpen(), 5)).not.toThrow();
  });

  it('accepts a very large quantity (no upper bound)', () => {
    expect(() => validateGroupQuantity(makeOpen(), 500)).not.toThrow();
  });

  it('throws GroupQuantityError when quantity is below min', () => {
    expect(() => validateGroupQuantity(makeOpen(), 4)).toThrow(GroupQuantityError);
  });

  it('throws GroupQuantityError for zero quantity', () => {
    expect(() => validateGroupQuantity(makeOpen(), 0)).toThrow(GroupQuantityError);
  });

  it('throws GroupQuantityError for negative quantity', () => {
    expect(() => validateGroupQuantity(makeOpen(), -1)).toThrow(GroupQuantityError);
  });
});

// ---------------------------------------------------------------------------
// calculateGroupTotal
// ---------------------------------------------------------------------------

describe('calculateGroupTotal', () => {
  it('returns price_per_person × quantity in haléře', () => {
    const total = calculateGroupTotal(makeFlexible(), 15);
    // 15 × 35 000 haléřů = 525 000 haléřů (= 5 250 Kč)
    expect(total).toBe(525_000);
  });

  it('returns correct amount for single person', () => {
    const total = calculateGroupTotal(makeFixed(), 1);
    expect(total).toBe(25_000);
  });

  it('returns correct amount for large open group', () => {
    const total = calculateGroupTotal(makeOpen(), 100);
    // 100 × 29 900 = 2 990 000 haléřů
    expect(total).toBe(2_990_000);
  });
});

// ---------------------------------------------------------------------------
// validateMemberList
// ---------------------------------------------------------------------------

describe('validateMemberList — requires_member_list = true', () => {
  const tt = makeFlexible({ requires_member_list: true });

  it('accepts a correctly sized member list', () => {
    const members = Array.from({ length: 10 }, (_, i) => ({
      name: `Osoba ${i + 1}`,
      email: `osoba${i + 1}@example.com`,
    }));
    expect(() => validateMemberList(tt, members, 10)).not.toThrow();
  });

  it('throws GroupMemberListError when list is empty', () => {
    expect(() => validateMemberList(tt, [], 10)).toThrow(GroupMemberListError);
  });

  it('throws GroupMemberListError when list length < quantity', () => {
    const members = [{ name: 'Jan Novák', email: null }];
    expect(() => validateMemberList(tt, members, 10)).toThrow(GroupMemberListError);
  });

  it('throws GroupMemberListError when list length > quantity', () => {
    const members = Array.from({ length: 12 }, (_, i) => ({
      name: `Osoba ${i + 1}`,
      email: null,
    }));
    expect(() => validateMemberList(tt, members, 10)).toThrow(GroupMemberListError);
  });

  it('throws GroupMemberListError when a member name is empty string', () => {
    const members = [
      { name: 'Jan Novák', email: null },
      { name: '', email: null },         // invalid
    ];
    expect(() => validateMemberList(tt, members, 2)).toThrow(GroupMemberListError);
  });
});

describe('validateMemberList — requires_member_list = false', () => {
  const tt = makeFlexible({ requires_member_list: false });

  it('accepts an empty member list', () => {
    expect(() => validateMemberList(tt, [], 15)).not.toThrow();
  });

  it('accepts a correctly sized optional member list', () => {
    const members = Array.from({ length: 15 }, (_, i) => ({
      name: `Člen ${i + 1}`,
      email: null,
    }));
    expect(() => validateMemberList(tt, members, 15)).not.toThrow();
  });

  it('throws GroupMemberListError on partial optional list (length mismatch)', () => {
    const members = [{ name: 'Jan Novák', email: null }]; // only 1, qty = 15
    expect(() => validateMemberList(tt, members, 15)).toThrow(GroupMemberListError);
  });
});

// ---------------------------------------------------------------------------
// generateMemberPlaceholders
// ---------------------------------------------------------------------------

describe('generateMemberPlaceholders', () => {
  it('generates the correct number of placeholders', () => {
    const placeholders = generateMemberPlaceholders(10);
    expect(placeholders).toHaveLength(10);
  });

  it('uses Czech name format "Člen N"', () => {
    const placeholders = generateMemberPlaceholders(3);
    expect(placeholders[0].name).toBe('Člen 1');
    expect(placeholders[1].name).toBe('Člen 2');
    expect(placeholders[2].name).toBe('Člen 3');
  });

  it('sets email to null for all placeholders', () => {
    const placeholders = generateMemberPlaceholders(5);
    placeholders.forEach((p) => expect(p.email).toBeNull());
  });

  it('generates a single placeholder correctly', () => {
    const [only] = generateMemberPlaceholders(1);
    expect(only).toEqual({ name: 'Člen 1', email: null });
  });
});

// ---------------------------------------------------------------------------
// formatGroupSummary
// ---------------------------------------------------------------------------

describe('formatGroupSummary', () => {
  it('formats Czech summary with correct quantity and amount', () => {
    const order = makeOrder({ quantity: 15, total_amount: 525_000 });
    const summary = formatGroupSummary(order, 'cs');
    // 525 000 haléřů = 5 250 Kč
    expect(summary).toContain('15');
    expect(summary).toContain('5');   // part of "5 250"
    expect(summary).toContain('Kč');
    expect(summary).toContain('Skupinová vstupenka');
  });

  it('formats English summary with correct quantity and amount', () => {
    const order = makeOrder({ quantity: 15, total_amount: 525_000 });
    const summary = formatGroupSummary(order, 'en');
    expect(summary).toContain('15');
    expect(summary).toContain('CZK');
    expect(summary).toContain('persons');
    expect(summary).toContain('Group ticket');
  });

  it('uses singular "osobu" in Czech for quantity = 1', () => {
    const order = makeOrder({ quantity: 1, total_amount: 35_000 });
    const summary = formatGroupSummary(order, 'cs');
    expect(summary).toContain('osobu');
  });

  it('uses "osoby" in Czech for quantity = 2', () => {
    const order = makeOrder({ quantity: 2, total_amount: 70_000 });
    const summary = formatGroupSummary(order, 'cs');
    expect(summary).toContain('osoby');
  });

  it('uses "osob" in Czech for quantity = 5', () => {
    const order = makeOrder({ quantity: 5, total_amount: 175_000 });
    const summary = formatGroupSummary(order, 'cs');
    expect(summary).toContain('osob');
  });

  it('uses singular "person" in English for quantity = 1', () => {
    const order = makeOrder({ quantity: 1, total_amount: 35_000 });
    const summary = formatGroupSummary(order, 'en');
    expect(summary).toContain('person');
    expect(summary).not.toContain('persons');
  });
});
