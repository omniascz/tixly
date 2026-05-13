import type { PromoCode, ApplyPromoCodeRequest, ApplyPromoCodeResult } from '../types/promo-code.types';
import { PromoCodeNotFoundError } from '../types/promo-code.types';
import { validatePromoCodeRules, calculateDiscount, generatePromoCode } from '../lib/promo-calculator';

// ─── DB adapter interface ─────────────────────────────────────────────────────

// Opaque transaction handle — implementation-specific
export type DbTransaction = Record<string, unknown>;

export interface DbAdapter {
  findPromoCode(code: string): Promise<PromoCode | null>;
  findPromoCodeById(id: string): Promise<PromoCode | null>;
  /** Returns how many times this user has used the given promo code */
  getPromoCodeUsesCount(promoCodeId: string, userId: string): Promise<number>;
  /** Atomically increments uses_count; must run inside a transaction */
  incrementPromoCodeUses(promoCodeId: string, tx: DbTransaction): Promise<void>;
  createPromoCode(
    data: Omit<PromoCode, 'id' | 'uses_count' | 'created_at'>,
  ): Promise<PromoCode>;
  listPromoCodesByOrganizer(organizerId: string): Promise<PromoCode[]>;
  updatePromoCode(id: string, data: Partial<PromoCode>): Promise<PromoCode>;
  deactivatePromoCode(id: string): Promise<void>;
  /** Runs fn inside a DB transaction; implementation should use SELECT … FOR UPDATE */
  withTransaction<T>(fn: (tx: DbTransaction) => Promise<T>): Promise<T>;
}

// ─── Service ──────────────────────────────────────────────────────────────────

export class PromoCodeService {
  /**
   * Validates the promo code against all rules, calculates the discount,
   * and atomically increments uses_count to prevent race conditions.
   */
  async validateAndApply(
    request: ApplyPromoCodeRequest,
    db: DbAdapter,
  ): Promise<ApplyPromoCodeResult> {
    const promoCode = await db.findPromoCode(request.code.toUpperCase());
    if (!promoCode) {
      throw new PromoCodeNotFoundError(request.code);
    }

    const userUsesCount = await db.getPromoCodeUsesCount(promoCode.id, request.user_id);

    // Validate before entering the transaction to fail fast
    validatePromoCodeRules(promoCode, request, userUsesCount, new Date());

    const result = calculateDiscount(promoCode, request);

    // Atomically increment to guard against concurrent redemptions
    await db.withTransaction(async (tx) => {
      await db.incrementPromoCodeUses(promoCode.id, tx);
    });

    return result;
  }

  /**
   * Creates a new promo code for the given organizer.
   * Generates a random code if none is supplied in data.
   */
  async createPromoCode(
    data: Omit<PromoCode, 'id' | 'uses_count' | 'created_at' | 'code' | 'created_by_organizer_id'> & {
      code?: string;
    },
    organizerId: string,
    db: DbAdapter,
  ): Promise<PromoCode> {
    const code = data.code ? data.code.toUpperCase() : generatePromoCode();

    const payload: Omit<PromoCode, 'id' | 'uses_count' | 'created_at'> = {
      ...data,
      code,
      created_by_organizer_id: organizerId,
    };

    return db.createPromoCode(payload);
  }

  /**
   * Lists all promo codes created by a given organizer.
   */
  async listOrganizerCodes(organizerId: string, db: DbAdapter): Promise<PromoCode[]> {
    return db.listPromoCodesByOrganizer(organizerId);
  }

  /**
   * Deactivates a promo code (soft delete).
   * Throws if the caller is not the organizer that created the code.
   */
  async deactivateCode(id: string, organizerId: string, db: DbAdapter): Promise<void> {
    const promoCode = await db.findPromoCodeById(id);
    if (!promoCode) {
      throw new PromoCodeNotFoundError(id);
    }
    if (promoCode.created_by_organizer_id !== organizerId) {
      throw new Error('Nemáte oprávnění deaktivovat tento promo kód');
    }
    await db.deactivatePromoCode(id);
  }

  /**
   * Updates mutable fields of a promo code.
   * Throws if the caller is not the organizer that created the code.
   */
  async updateCode(
    id: string,
    organizerId: string,
    patch: Pick<Partial<PromoCode>, 'active' | 'valid_until' | 'max_uses'>,
    db: DbAdapter,
  ): Promise<PromoCode> {
    const promoCode = await db.findPromoCodeById(id);
    if (!promoCode) {
      throw new PromoCodeNotFoundError(id);
    }
    if (promoCode.created_by_organizer_id !== organizerId) {
      throw new Error('Nemáte oprávnění upravit tento promo kód');
    }
    return db.updatePromoCode(id, patch);
  }
}
