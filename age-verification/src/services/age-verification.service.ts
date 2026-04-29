import { randomUUID } from 'crypto';
import type { DbAdapter, AgeVerification, AgeRows, ValidateResult } from '../lib/types.js';

interface OrderRow {
  id: string;
  user_id: string;
  promoter_id: string;
  requires_age_verification: boolean;
}

interface EventRow {
  id: string;
  min_age: number | null;
}

interface IdentityRow {
  id: string;
  verified_persons: string; // encrypted JSON
}

function mapAgeRow(row: AgeRows): AgeVerification {
  return {
    id: row.id,
    orderId: row.order_id,
    userId: row.user_id,
    promoterId: row.promoter_id,
    verifiedAt: row.verified_at,
    method: row.method as AgeVerification['method'],
    ageAtVerification: row.age_at_verification,
  };
}

/**
 * Calculates age in years from a birth date, handling leap years and year boundaries
 * @param birthDate - ISO date string (YYYY-MM-DD)
 * @returns Age in years
 * @throws if birthDate is invalid or in the future
 */
export function calculateAge(birthDate: string): number {
  const birth = new Date(birthDate);

  // Validate date is valid
  if (Number.isNaN(birth.getTime())) {
    throw new Error('VALIDATION_ERROR: Invalid date format');
  }

  const today = new Date();

  // Reject future dates
  if (birth > today) {
    throw new Error('VALIDATION_ERROR: Birth date cannot be in the future');
  }

  let age = today.getFullYear() - birth.getFullYear();
  const monthDiff = today.getMonth() - birth.getMonth();

  // If birthday hasn't occurred this year yet, subtract 1
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
    age--;
  }

  return age;
}

/**
 * Validates birth date against minimum age requirement
 * @param birthDate - ISO date string (YYYY-MM-DD)
 * @param minAge - Minimum required age
 * @returns Object with isValid flag and calculated age
 */
export function validateBirthDate(birthDate: string, minAge: number): ValidateResult {
  try {
    const age = calculateAge(birthDate);
    return {
      isValid: age >= minAge,
      ageYears: age,
    };
  } catch {
    return {
      isValid: false,
      ageYears: 0,
    };
  }
}

/**
 * Checks if an order requires age verification
 * @param orderId - Order ID
 * @param db - Database adapter
 * @returns true if order requires age verification
 * @throws INTERNAL_ERROR if order or event not found
 */
export async function requiresAgeVerification(
  orderId: string,
  db: DbAdapter,
): Promise<boolean> {
  try {
    const orders = await db.query<OrderRow>(
      `SELECT o.id, o.user_id, o.promoter_id, o.requires_age_verification
       FROM orders.orders o
       WHERE o.id = $1 LIMIT 1`,
      [orderId],
    );

    if (orders.length === 0) {
      throw new Error('INTERNAL_ERROR: Order not found');
    }

    return orders[0].requires_age_verification;
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('INTERNAL_ERROR')) {
      throw err;
    }
    throw new Error('INTERNAL_ERROR: Failed to check age verification requirement');
  }
}

/**
 * Verifies age for an order and records verification
 * @param orderId - Order ID
 * @param birthDate - ISO date string (YYYY-MM-DD)
 * @param method - Verification method ('self_declared' or 'bankid')
 * @param db - Database adapter
 * @returns AgeVerification record
 * @throws VALIDATION_ERROR for invalid dates, INTERNAL_ERROR for DB issues
 */
export async function verifyAge(
  orderId: string,
  birthDate: string,
  method: 'self_declared' | 'bankid' = 'self_declared',
  db: DbAdapter,
): Promise<AgeVerification> {
  try {
    // Validate birth date
    let ageAtVerification: number;
    try {
      ageAtVerification = calculateAge(birthDate);
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('VALIDATION_ERROR')) {
        throw err;
      }
      throw new Error('VALIDATION_ERROR: Invalid birth date');
    }

    // Get order details
    const orders = await db.query<OrderRow & { event_id: string }>(
      `SELECT o.id, o.user_id, o.promoter_id, oi.ticket_type_id
       FROM orders.orders o
       LEFT JOIN orders.order_items oi ON o.id = oi.order_id
       WHERE o.id = $1 LIMIT 1`,
      [orderId],
    );

    if (orders.length === 0) {
      throw new Error('INTERNAL_ERROR: Order not found');
    }

    const order = orders[0];

    // Check for existing verification (update if exists)
    const existing = await db.query<AgeRows>(
      `SELECT * FROM age_verifications WHERE order_id = $1`,
      [orderId],
    );

    const id = existing.length > 0 ? existing[0].id : randomUUID();
    const verifiedAt = new Date().toISOString();

    if (existing.length > 0) {
      // Update existing verification
      await db.execute(
        `UPDATE age_verifications
         SET age_at_verification = $1, method = $2, verified_at = $3, updated_at = $4
         WHERE order_id = $5`,
        [ageAtVerification, method, verifiedAt, verifiedAt, orderId],
      );
    } else {
      // Create new verification
      await db.execute(
        `INSERT INTO age_verifications
         (id, order_id, user_id, promoter_id, verified_at, method, age_at_verification, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          id,
          orderId,
          order.user_id,
          order.promoter_id,
          verifiedAt,
          method,
          ageAtVerification,
          verifiedAt,
          verifiedAt,
        ],
      );
    }

    return {
      id,
      orderId,
      userId: order.user_id,
      promoterId: order.promoter_id,
      verifiedAt,
      method,
      ageAtVerification,
    };
  } catch (err) {
    if (err instanceof Error && (err.message.startsWith('VALIDATION_ERROR') || err.message.startsWith('INTERNAL_ERROR'))) {
      throw err;
    }
    throw new Error('INTERNAL_ERROR: Failed to verify age');
  }
}

/**
 * Gets existing verification for an order
 * @param orderId - Order ID
 * @param db - Database adapter
 * @returns AgeVerification record or null if not found
 */
export async function getVerificationForOrder(
  orderId: string,
  db: DbAdapter,
): Promise<AgeVerification | null> {
  try {
    const rows = await db.query<AgeRows>(
      `SELECT * FROM age_verifications WHERE order_id = $1 LIMIT 1`,
      [orderId],
    );

    if (rows.length === 0) return null;
    return mapAgeRow(rows[0]);
  } catch {
    throw new Error('INTERNAL_ERROR: Failed to retrieve verification');
  }
}

/**
 * Gets age from BankID identity verification
 * @param userId - User ID
 * @param db - Database adapter
 * @returns Age calculated from verified identity, or null if not verified
 * @throws INTERNAL_ERROR if DB query fails
 */
export async function getIdentityAgeFromBankID(
  userId: string,
  db: DbAdapter,
): Promise<number | null> {
  try {
    const rows = await db.query<IdentityRow>(
      `SELECT verified_persons FROM identity.users WHERE id = $1 LIMIT 1`,
      [userId],
    );

    if (rows.length === 0) {
      return null;
    }

    const row = rows[0];

    // In a real implementation, this would decrypt verified_persons JSON
    // For now, return null to indicate no BankID verification
    if (!row.verified_persons) {
      return null;
    }

    try {
      // Parse verified_persons (would be decrypted in real implementation)
      const verified = JSON.parse(row.verified_persons);
      if (verified.birth_date) {
        return calculateAge(verified.birth_date);
      }
    } catch {
      return null;
    }

    return null;
  } catch {
    throw new Error('INTERNAL_ERROR: Failed to retrieve identity verification');
  }
}
