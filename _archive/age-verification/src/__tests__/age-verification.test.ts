import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  calculateAge,
  validateBirthDate,
  requiresAgeVerification,
  verifyAge,
  getVerificationForOrder,
  getIdentityAgeFromBankID,
} from '../services/age-verification.service.js';
import type { DbAdapter } from '../lib/types.js';

// ---------------------------------------------------------------------------
// Mock DbAdapter factory
// ---------------------------------------------------------------------------

function makeDb(overrides: Partial<DbAdapter> = {}): DbAdapter {
  return {
    query: vi.fn().mockResolvedValue([]),
    execute: vi.fn().mockResolvedValue(undefined),
    transaction: vi.fn().mockImplementation(async (fn) => fn(makeDb(overrides))),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Test data helpers
// ---------------------------------------------------------------------------

const NOW = new Date();
const YEAR = NOW.getFullYear();
const MONTH = String(NOW.getMonth() + 1).padStart(2, '0');
const DAY = String(NOW.getDate()).padStart(2, '0');
const TODAY_ISO = `${YEAR}-${MONTH}-${DAY}`;

// Dates for testing
const LEAP_YEAR_DATE = '2000-02-29';
const BIRTH_18_YEARS_AGO = `${YEAR - 18}-${MONTH}-${DAY}`;
const BIRTH_17_YEARS_AGO = `${YEAR - 17}-${MONTH}-${DAY}`;
const BIRTH_21_YEARS_AGO = `${YEAR - 21}-${MONTH}-${DAY}`;
const FUTURE_DATE = `${YEAR + 1}-${MONTH}-${DAY}`;
const INVALID_DATE = '2000-13-45';

// ---------------------------------------------------------------------------
// 1. calculateAge
// ---------------------------------------------------------------------------

describe('calculateAge', () => {
  // Test 1: Exact age on birthday
  it('1. returns correct age on exact birthday', () => {
    const age = calculateAge(BIRTH_18_YEARS_AGO);
    expect(age).toBe(18);
  });

  // Test 2: Leap year handling
  it('2. handles leap year birth date (Feb 29)', () => {
    const age = calculateAge(LEAP_YEAR_DATE);
    expect(age).toBeGreaterThanOrEqual(20);
  });

  // Test 3: Year boundary (birthday in future this year)
  it('3. returns age - 1 when birthday not yet occurred this year', () => {
    const nextMonth = (NOW.getMonth() + 2) % 12;
    const futureThisYear = `${YEAR - 18}-${String(nextMonth + 1).padStart(2, '0')}-15`;
    const age = calculateAge(futureThisYear);
    expect(age).toBe(17);
  });

  // Test 4: Rejects future dates
  it('4. throws VALIDATION_ERROR for future dates', () => {
    expect(() => calculateAge(FUTURE_DATE)).toThrow('VALIDATION_ERROR: Birth date cannot be in the future');
  });

  // Test 5: Rejects invalid dates
  it('5. throws VALIDATION_ERROR for invalid date format', () => {
    expect(() => calculateAge(INVALID_DATE)).toThrow('VALIDATION_ERROR: Invalid date format');
  });

  // Test 6: Handles very old ages
  it('6. calculates correct age for very old dates (1900)', () => {
    const age = calculateAge('1900-01-01');
    expect(age).toBeGreaterThan(120);
  });
});

// ---------------------------------------------------------------------------
// 2. validateBirthDate
// ---------------------------------------------------------------------------

describe('validateBirthDate', () => {
  // Test 7: Under-age person fails validation
  it('7. returns isValid false for person under minimum age', () => {
    const result = validateBirthDate(BIRTH_17_YEARS_AGO, 18);
    expect(result.isValid).toBe(false);
    expect(result.ageYears).toBe(17);
  });

  // Test 8: Exactly at minimum age passes
  it('8. returns isValid true when exactly at minimum age', () => {
    const result = validateBirthDate(BIRTH_18_YEARS_AGO, 18);
    expect(result.isValid).toBe(true);
    expect(result.ageYears).toBe(18);
  });

  // Test 9: Over minimum age passes
  it('9. returns isValid true for age over minimum', () => {
    const result = validateBirthDate(BIRTH_21_YEARS_AGO, 18);
    expect(result.isValid).toBe(true);
    expect(result.ageYears).toBe(21);
  });

  // Test 10: Invalid date returns isValid false
  it('10. returns isValid false for invalid date', () => {
    const result = validateBirthDate(INVALID_DATE, 18);
    expect(result.isValid).toBe(false);
    expect(result.ageYears).toBe(0);
  });

  // Test 11: Future date returns isValid false
  it('11. returns isValid false for future date', () => {
    const result = validateBirthDate(FUTURE_DATE, 18);
    expect(result.isValid).toBe(false);
    expect(result.ageYears).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 3. requiresAgeVerification
// ---------------------------------------------------------------------------

describe('requiresAgeVerification', () => {
  // Test 12: Returns true for order requiring age verification
  it('12. returns true when order requires age verification', async () => {
    const db = makeDb({
      query: vi.fn().mockResolvedValueOnce([
        {
          id: 'ord-1',
          user_id: 'user-1',
          promoter_id: 'prm-1',
          requires_age_verification: true,
        },
      ]),
    });

    const result = await requiresAgeVerification('ord-1', db);
    expect(result).toBe(true);
  });

  // Test 13: Returns false for order not requiring age verification
  it('13. returns false when order does not require age verification', async () => {
    const db = makeDb({
      query: vi.fn().mockResolvedValueOnce([
        {
          id: 'ord-1',
          user_id: 'user-1',
          promoter_id: 'prm-1',
          requires_age_verification: false,
        },
      ]),
    });

    const result = await requiresAgeVerification('ord-1', db);
    expect(result).toBe(false);
  });

  // Test 14: Throws INTERNAL_ERROR if order not found
  it('14. throws INTERNAL_ERROR when order not found', async () => {
    const db = makeDb({
      query: vi.fn().mockResolvedValueOnce([]),
    });

    await expect(requiresAgeVerification('ord-999', db)).rejects.toThrow('INTERNAL_ERROR: Order not found');
  });
});

// ---------------------------------------------------------------------------
// 4. verifyAge
// ---------------------------------------------------------------------------

describe('verifyAge', () => {
  // Test 15: Creates new verification with self_declared method
  it('15. creates new age verification with self_declared method', async () => {
    const db = makeDb({
      query: vi
        .fn()
        .mockResolvedValueOnce([
          {
            id: 'ord-1',
            user_id: 'user-1',
            promoter_id: 'prm-1',
          },
        ])
        .mockResolvedValueOnce([]), // No existing verification
    });

    const result = await verifyAge('ord-1', BIRTH_21_YEARS_AGO, 'self_declared', db);

    expect(result.orderId).toBe('ord-1');
    expect(result.userId).toBe('user-1');
    expect(result.promoterId).toBe('prm-1');
    expect(result.method).toBe('self_declared');
    expect(result.ageAtVerification).toBeGreaterThanOrEqual(21);
    expect(db.execute).toHaveBeenCalled();
  });

  // Test 16: Creates verification with bankid method
  it('16. creates new verification with bankid method', async () => {
    const db = makeDb({
      query: vi
        .fn()
        .mockResolvedValueOnce([
          {
            id: 'ord-1',
            user_id: 'user-1',
            promoter_id: 'prm-1',
          },
        ])
        .mockResolvedValueOnce([]),
    });

    const result = await verifyAge('ord-1', BIRTH_21_YEARS_AGO, 'bankid', db);
    expect(result.method).toBe('bankid');
  });

  // Test 17: Updates existing verification
  it('17. updates existing verification instead of creating new', async () => {
    const existingId = 'ver-1';
    const db = makeDb({
      query: vi
        .fn()
        .mockResolvedValueOnce([
          {
            id: 'ord-1',
            user_id: 'user-1',
            promoter_id: 'prm-1',
          },
        ])
        .mockResolvedValueOnce([
          {
            id: existingId,
            order_id: 'ord-1',
            user_id: 'user-1',
            promoter_id: 'prm-1',
            verified_at: new Date().toISOString(),
            method: 'self_declared',
            age_at_verification: 19,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ]),
    });

    const result = await verifyAge('ord-1', BIRTH_21_YEARS_AGO, 'bankid', db);
    expect(result.id).toBe(existingId);
    expect(result.ageAtVerification).toBeGreaterThanOrEqual(21);
  });

  // Test 18: Throws VALIDATION_ERROR for invalid birth date
  it('18. throws VALIDATION_ERROR for invalid birth date', async () => {
    const db = makeDb();
    await expect(verifyAge('ord-1', INVALID_DATE, 'self_declared', db)).rejects.toThrow('VALIDATION_ERROR');
  });

  // Test 19: Throws INTERNAL_ERROR if order not found
  it('19. throws INTERNAL_ERROR if order not found', async () => {
    const db = makeDb({
      query: vi.fn().mockResolvedValueOnce([]),
    });

    await expect(verifyAge('ord-999', BIRTH_21_YEARS_AGO, 'self_declared', db)).rejects.toThrow('INTERNAL_ERROR: Order not found');
  });

  // Test 20: Default method is self_declared
  it('20. defaults to self_declared method when not specified', async () => {
    const db = makeDb({
      query: vi
        .fn()
        .mockResolvedValueOnce([
          {
            id: 'ord-1',
            user_id: 'user-1',
            promoter_id: 'prm-1',
          },
        ])
        .mockResolvedValueOnce([]),
    });

    const result = await verifyAge('ord-1', BIRTH_21_YEARS_AGO, undefined, db);
    expect(result.method).toBe('self_declared');
  });
});

// ---------------------------------------------------------------------------
// 5. getVerificationForOrder
// ---------------------------------------------------------------------------

describe('getVerificationForOrder', () => {
  // Test 21: Returns existing verification
  it('21. returns existing verification for order', async () => {
    const db = makeDb({
      query: vi.fn().mockResolvedValueOnce([
        {
          id: 'ver-1',
          order_id: 'ord-1',
          user_id: 'user-1',
          promoter_id: 'prm-1',
          verified_at: new Date().toISOString(),
          method: 'self_declared',
          age_at_verification: 21,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ]),
    });

    const result = await getVerificationForOrder('ord-1', db);
    expect(result).not.toBeNull();
    expect(result?.orderId).toBe('ord-1');
    expect(result?.ageAtVerification).toBe(21);
  });

  // Test 22: Returns null when no verification exists
  it('22. returns null when no verification exists for order', async () => {
    const db = makeDb({
      query: vi.fn().mockResolvedValueOnce([]),
    });

    const result = await getVerificationForOrder('ord-999', db);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 6. getIdentityAgeFromBankID
// ---------------------------------------------------------------------------

describe('getIdentityAgeFromBankID', () => {
  // Test 23: Returns age from verified identity
  it('23. returns age calculated from verified identity', async () => {
    const db = makeDb({
      query: vi.fn().mockResolvedValueOnce([
        {
          id: 'user-1',
          verified_persons: JSON.stringify({
            birth_date: BIRTH_21_YEARS_AGO,
          }),
        },
      ]),
    });

    const age = await getIdentityAgeFromBankID('user-1', db);
    expect(age).toBeGreaterThanOrEqual(21);
  });

  // Test 24: Returns null for user with no identity verification
  it('24. returns null when user has no identity verification', async () => {
    const db = makeDb({
      query: vi.fn().mockResolvedValueOnce([
        {
          id: 'user-1',
          verified_persons: null,
        },
      ]),
    });

    const age = await getIdentityAgeFromBankID('user-1', db);
    expect(age).toBeNull();
  });

  // Test 25: Returns null when user not found
  it('25. returns null when user not found', async () => {
    const db = makeDb({
      query: vi.fn().mockResolvedValueOnce([]),
    });

    const age = await getIdentityAgeFromBankID('user-999', db);
    expect(age).toBeNull();
  });

  // Test 26: Throws INTERNAL_ERROR on database error
  it('26. throws INTERNAL_ERROR on database query error', async () => {
    const db = makeDb({
      query: vi.fn().mockRejectedValueOnce(new Error('DB connection failed')),
    });

    await expect(getIdentityAgeFromBankID('user-1', db)).rejects.toThrow('INTERNAL_ERROR');
  });
});
