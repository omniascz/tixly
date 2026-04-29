/**
 * @tixly/rls-multitenancy — tenantContextFromJwt
 *
 * Vytvoří TenantContext z dekódovaného JWT payloadu.
 * Volá se v API route handlerech po requireUser / requirePromoterMember.
 */

import type { TenantContext } from '../types/tenant';

/**
 * Minimální subset JWT payloadu potřebný pro určení tenant kontextu.
 * Kompatibilní s AccessTokenPayload z @tixly/jwt-auth.
 *
 * - `sub`     — UUID uživatele (Subject claim)
 * - `isAdmin` — true pokud má platform-admin práva
 */
export interface AccessTokenPayload {
  /** UUID uživatele */
  sub: string;
  /** Platform admin příznak */
  isAdmin?: boolean;
  /** Libovolné další claims (nepoužívají se pro RLS) */
  [key: string]: unknown;
}

export interface TenantContextOptions {
  /**
   * Promoter UUID — pokud je endpoint specifický pro promotéra.
   * Nastavení této hodnoty způsobí role='promoter' (pokud user není admin).
   */
  promoterId?: string;
}

/**
 * Vytvoří TenantContext z JWT payloadu.
 *
 * Prioritní logika:
 * 1. `payload.isAdmin === true` → role='admin' (ignoruje promoterId)
 * 2. `options.promoterId` zadán → role='promoter', promoterId z options
 * 3. Jinak → role='buyer', userId=payload.sub
 *
 * @param payload  Dekódovaný JWT payload
 * @param options  Volitelné — promoterId pro promoter-specific endpointy
 *
 * @example
 * // Admin endpoint:
 * const ctx = tenantContextFromJwt(payload);
 * // → { role: 'admin', userId: payload.sub }
 *
 * @example
 * // Promoter endpoint (po requirePromoterMember):
 * const ctx = tenantContextFromJwt(payload, { promoterId: 'uuid...' });
 * // → { role: 'promoter', promoterId: 'uuid...', userId: payload.sub }
 *
 * @example
 * // Buyer endpoint:
 * const ctx = tenantContextFromJwt(payload);
 * // → { role: 'buyer', userId: payload.sub }
 */
export function tenantContextFromJwt(
  payload: AccessTokenPayload,
  options?: TenantContextOptions,
): TenantContext {
  const userId = payload.sub;

  // Admin přebíjí vše — admin má full access bez ohledu na promoterId
  if (payload.isAdmin === true) {
    return {
      role: 'admin',
      userId,
    };
  }

  // Promoter endpoint — options.promoterId musí být zadán
  if (options?.promoterId !== undefined) {
    return {
      role: 'promoter',
      promoterId: options.promoterId,
      userId,
    };
  }

  // Výchozí — buyer (přihlášený uživatel bez admin/promoter práv)
  return {
    role: 'buyer',
    userId,
  };
}
