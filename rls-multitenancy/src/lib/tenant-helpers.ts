/**
 * @tixly/rls-multitenancy — Tenant context helpers
 *
 * Convenience factory funkce pro vytváření TenantContext objektů.
 * Používají se v API route handlerech a service vrstvě.
 */

import type { TenantContext } from '../types/tenant';

/**
 * Kontext pro interní service operace — full access.
 * Používá se pro: cron joby, migrační skripty, background workery.
 *
 * @example
 * await withTenantContext(db, serviceContext(), async (db) => {
 *   // Vidí všechna data přes RLS
 *   return db.query('SELECT * FROM catalog.events');
 * });
 */
export function serviceContext(): TenantContext {
  return { role: 'service' };
}

/**
 * Kontext pro platform administrátory — full access.
 *
 * @param userId UUID administrátora (z JWT sub claim)
 *
 * @example
 * await withTenantContext(db, adminContext(userId), async (db) => {
 *   return db.query('SELECT * FROM orders.orders');
 * });
 */
export function adminContext(userId: string): TenantContext {
  return { role: 'admin', userId };
}

/**
 * Kontext pro promotéra — vidí jen svá data.
 * RLS policy filtruje řádky kde organizer_id/promoter_id = promoterId.
 *
 * @param promoterId UUID promotéra (z URL params nebo JWT claims)
 * @param userId     UUID přihlášeného uživatele (z JWT sub claim)
 *
 * @example
 * // V promoter API route handleru:
 * const ctx = promoterContext(params.promoterId, userId);
 * await withTenantContext(db, ctx, async (db) => {
 *   return db.query('SELECT * FROM catalog.events');
 *   // RLS: WHERE organizer_id = app.current_promoter_id
 * });
 */
export function promoterContext(promoterId: string, userId: string): TenantContext {
  return { role: 'promoter', promoterId, userId };
}

/**
 * Kontext pro přihlášeného kupujícího — vidí jen své objednávky a vstupenky.
 * RLS policy filtruje řádky kde user_id = userId.
 *
 * @param userId UUID kupujícího (z JWT sub claim)
 *
 * @example
 * // V buyer API route handleru:
 * await withTenantContext(db, buyerContext(userId), async (db) => {
 *   return db.query('SELECT * FROM orders.orders');
 *   // RLS: WHERE user_id = app.current_user_id
 * });
 */
export function buyerContext(userId: string): TenantContext {
  return { role: 'buyer', userId };
}
