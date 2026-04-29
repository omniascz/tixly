/**
 * @tixly/rls-multitenancy
 *
 * PostgreSQL Row Level Security multi-tenancy pro Tixly platformu.
 *
 * Veřejné API modulu:
 * - `withTenantContext` — obalí DB volání s RLS session proměnnými
 * - `tenantContextFromJwt` — vytvoří kontext z JWT payloadu
 * - helper factory funkce: serviceContext, adminContext, promoterContext, buyerContext
 * - typy: TenantContext, AppRole
 *
 * @example
 * import { withTenantContext, promoterContext } from '@tixly/rls-multitenancy';
 *
 * const events = await withTenantContext(
 *   deps.db,
 *   promoterContext(promoterId, userId),
 *   (db) => db.query('SELECT * FROM catalog.events'),
 * );
 */

export { withTenantContext } from './lib/tenant-context';
export { tenantContextFromJwt } from './lib/tenant-from-jwt';
export type { AccessTokenPayload, TenantContextOptions } from './lib/tenant-from-jwt';
export { serviceContext, adminContext, promoterContext, buyerContext } from './lib/tenant-helpers';
export type { TenantContext, AppRole } from './types/tenant';
export type { DbAdapter } from './lib/service-container';
