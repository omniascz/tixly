/**
 * @tixly/rls-multitenancy — withTenantContext
 *
 * Obalí DB adapter s tenant kontextem pomocí PostgreSQL SET LOCAL.
 * Všechny dotazy uvnitř fn() vidí jen data odpovídající danému kontextu,
 * protože RLS policies čtou app.current_* session proměnné.
 *
 * SECURITY: promoterId a userId jsou validovány jako UUID před vložením
 * do SQL — ochrana před SQL injection.
 */

import type { DbAdapter } from './service-container';
import type { TenantContext } from '../types/tenant';

/**
 * UUID regex — RFC 4122 formát.
 * Používá se k validaci promoterId a userId před vložením do SET LOCAL.
 */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Validuje UUID string. Hází error pokud hodnota není platné UUID.
 * Prázdný string / undefined jsou povoleny (mapují se na prázdný kontext).
 */
function validateUuid(value: string, fieldName: string): void {
  if (!UUID_REGEX.test(value)) {
    throw new Error(
      `RLS security error: ${fieldName} must be a valid UUID, got: "${value}". ` +
        'Possible SQL injection attempt blocked.',
    );
  }
}

/**
 * Whitelist povolených rolí pro app.current_role.
 * Runtime validace je nutná — TypeScript typy nejsou vynuceny za běhu,
 * útočník může přes HTTP poslat libovolný string.
 */
const VALID_ROLES = ['service', 'admin', 'promoter', 'buyer'] as const;
type AppRole = typeof VALID_ROLES[number];

/**
 * Assertion funkce — ověří že role je z whitelistu před vložením do SET LOCAL.
 * Hází error při neplatné hodnotě (ochrana před SQL injection přes pole role).
 */
function assertValidRole(role: string): asserts role is AppRole {
  if (!(VALID_ROLES as readonly string[]).includes(role)) {
    throw new Error(
      `RLS security error: invalid role "${role}". ` +
        `Allowed values: ${VALID_ROLES.join(', ')}. Possible SQL injection attempt blocked.`,
    );
  }
}

/**
 * Nastaví PostgreSQL session proměnné pro RLS a zavolá fn().
 *
 * Implementace:
 * 1. Otevře transakci (SET LOCAL je scoped na transakci)
 * 2. SET LOCAL app.current_promoter_id
 * 3. SET LOCAL app.current_user_id
 * 4. SET LOCAL app.current_role
 * 5. Zavolá fn(db) — všechny dotazy mají RLS kontext
 * 6. Commit (nebo rollback při chybě)
 *
 * @example
 * // V API route handleru (promoter endpoint):
 * const result = await withTenantContext(deps.db, promoterContext(promoterId, userId), async (db) => {
 *   return db.query('SELECT * FROM catalog.events');
 *   // RLS automaticky filtruje: WHERE organizer_id = app.current_promoter_id
 * });
 *
 * @example
 * // V API route handleru (buyer endpoint):
 * const orders = await withTenantContext(deps.db, buyerContext(userId), async (db) => {
 *   return db.query('SELECT * FROM orders.orders');
 *   // RLS automaticky filtruje: WHERE user_id = app.current_user_id
 * });
 *
 * // BEFORE (mock headers — nebezpečné, aplikační filtrování):
 * // const organizerId = request.headers.get('x-organizer-id');
 * // const events = await db.query(
 * //   'SELECT * FROM catalog.events WHERE organizer_id = $1',
 * //   [organizerId]
 * // );
 *
 * // AFTER (RLS + tenant context — vynuceno na DB úrovni):
 * // const { userId } = await requirePromoterMember(request, promoterId, ['owner', 'admin'], deps);
 * // const result = await withTenantContext(
 * //   deps.db,
 * //   promoterContext(promoterId, userId),
 * //   async (db) => db.query('SELECT * FROM catalog.events')
 * // );
 */
export async function withTenantContext<T>(
  db: DbAdapter,
  context: TenantContext,
  fn: (db: DbAdapter) => Promise<T>,
): Promise<T> {
  // Validace UUID hodnot před vložením do SQL (SQL injection prevence)
  if (context.promoterId !== undefined && context.promoterId !== '') {
    validateUuid(context.promoterId, 'promoterId');
  }
  if (context.userId !== undefined && context.userId !== '') {
    validateUuid(context.userId, 'userId');
  }

  const promoterIdValue = context.promoterId ?? '';
  const userIdValue = context.userId ?? '';
  const roleValue = context.role;

  // Whitelist validace role před vložením do SET LOCAL (SQL injection prevence).
  // TypeScript union type nestačí — runtime hodnota může být cokoliv.
  assertValidRole(roleValue);

  return db.transaction(async (tx) => {
    // SET LOCAL je scoped na aktuální transakci — po commitu/rollbacku
    // se hodnoty automaticky resetují. To zaručuje izolaci mezi requesty.
    await tx.execute(`SET LOCAL app.current_promoter_id = '${promoterIdValue}'`);
    await tx.execute(`SET LOCAL app.current_user_id = '${userIdValue}'`);
    await tx.execute(`SET LOCAL app.current_role = '${roleValue}'`);

    return fn(tx);
  });
}
