/**
 * db-adapter.ts
 *
 * Stub factory that returns an InsuranceDbAdapter implementation.
 * Replace the body of getDbAdapter() with your actual ORM / database client
 * (e.g. Prisma, Drizzle, Supabase) when wiring up to a real database.
 */
import type { InsuranceDbAdapter } from '../services/insurance.service';

export function getDbAdapter(): InsuranceDbAdapter {
  throw new Error(
    'getDbAdapter() is not implemented. ' +
      'Replace this stub with your actual database adapter.',
  );
}
