/**
 * @tixly/rls-multitenancy — Tenant types
 *
 * Definice rolí a kontextu pro Row Level Security.
 */

/**
 * Role aplikace — určuje úroveň přístupu v RLS policies.
 *
 * - `service`  → full access (cron joby, migrační skripty)
 * - `admin`    → full access (platform administrátor)
 * - `promoter` → vidí jen svá data (kde organizer_id = promoterId)
 * - `buyer`    → vidí jen své objednávky a vstupenky (kde user_id = userId)
 */
export type AppRole = 'service' | 'admin' | 'promoter' | 'buyer';

/**
 * Kontext tenanta — nastavuje se před každým DB dotazem.
 * Mapuje se na PostgreSQL session proměnné:
 *   app.current_promoter_id, app.current_user_id, app.current_role
 */
export interface TenantContext {
  /** Role pro RLS policies */
  role: AppRole;
  /** UUID promotéra — povinné pro role='promoter' */
  promoterId?: string;
  /** UUID uživatele — povinné pro role='buyer' */
  userId?: string;
}
