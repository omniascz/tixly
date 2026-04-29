import type { NextRequest } from 'next/server';
import { Pool } from 'pg';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

export interface PromoterContext {
  userId: string;
  promoterId: string;
  promoterSlug: string;
  promoterName: string;
  status: 'pending' | 'active' | 'suspended';
  role: string;
}

/**
 * Resolve the active promoter context for the authenticated user.
 * Returns null if there's no active membership (or no user header).
 *
 * The middleware sets `x-user-id` after verifying the JWT.
 */
export async function requirePromoter(
  req: NextRequest,
): Promise<PromoterContext | null> {
  const userId = req.headers.get('x-user-id');
  if (!userId) return null;

  const result = await db().query<{
    promoter_id: string;
    slug: string;
    name: string;
    status: 'pending' | 'active' | 'suspended';
    role: string;
  }>(
    `SELECT pm.promoter_id, p.slug, p.name, p.status, pm.role::text AS role
     FROM platform.promoter_members pm
     JOIN platform.promoters p ON p.id = pm.promoter_id
     WHERE pm.user_id = $1
     ORDER BY (p.status = 'active') DESC, p.created_at ASC
     LIMIT 1`,
    [userId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    userId,
    promoterId: row.promoter_id,
    promoterSlug: row.slug,
    promoterName: row.name,
    status: row.status,
    role: row.role,
  };
}
