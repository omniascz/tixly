/**
 * Kdo smí použít kredit firemního (B2B) účtu.
 *
 * Kolo 4: kód účtu (8 hex znaků, firmy ho sdílejí mezi zaměstnanci) dřív stačil ke zjištění
 * zůstatku (/api/b2b/verify) i k platbě z kreditu (/api/checkout, paymentMethod=b2b_credit).
 * E-mail v těle požadavku nic neprokazuje. Oprávněný je jen PŘIHLÁŠENÝ uživatel (ověřené
 * x-user-id z middleware), jehož e-mail je členem účtu — připojený (joined_at) nebo admin účtu.
 *
 * Volat se servisním kontextem / klientem v transakci: tabulky b2b_* mají jen servisní policy.
 */
/** Stačí `db()` (RlsAwarePool) i syrový `PoolClient` v transakci. */
interface Queryable {
  query: (text: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
}

export interface AuthorizedB2BAccount {
  accountId: string;
  companyName: string;
  balanceHalire: number;
}

export async function authorizeB2BCreditUser(
  q: Queryable,
  accountCode: string,
  userId: string | null,
  opts: { forUpdate?: boolean } = {},
): Promise<AuthorizedB2BAccount | null> {
  if (!userId || !/^[0-9a-f-]{36}$/i.test(userId)) return null;
  const r = (await q.query(
    `SELECT a.id, a.company_name, a.credit_balance_halire
       FROM platform.b2b_accounts a
       JOIN platform.b2b_account_users au ON au.account_id = a.id
       JOIN identity.users u ON lower(u.email) = lower(au.email)
      WHERE a.account_code = upper($1) AND a.status = 'active'
        AND u.id = $2 AND (au.joined_at IS NOT NULL OR au.is_admin)
      LIMIT 1
      ${opts.forUpdate ? 'FOR UPDATE OF a' : ''}`,
    [accountCode, userId],
  )) as { rows: { id: string; company_name: string; credit_balance_halire: string }[] };
  const row = r.rows[0];
  if (!row) return null;
  return { accountId: row.id, companyName: row.company_name, balanceHalire: parseInt(row.credit_balance_halire, 10) };
}
