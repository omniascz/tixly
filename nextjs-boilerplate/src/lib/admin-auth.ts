import type { NextRequest } from 'next/server';
import { db as rlsDb, runWithPromoterContext, runWithServiceContext } from './db/rls-pool';

export interface PromoterContext {
  userId: string;
  promoterId: string;
  promoterSlug: string;
  promoterName: string;
  status: 'pending' | 'active' | 'suspended';
  role: string;
}

/**
 * RLS-aware DB helpers — re-export. Endpointy by měly volat:
 *
 *   const ctx = await requirePromoter(req);
 *   await withPromoterDb(ctx.promoterId, async (client) => {
 *     await client.query('SELECT * FROM catalog.events');
 *     // RLS automaticky scoped na promoter_id = ctx.promoterId
 *   });
 *
 * Bez session vars: app jako `tixly_app` user vidí jen `status='published'`.
 */
export {
  withPromoterDb,
  withPlatformAdminDb,
  withAnonDb,
  queryAsPromoter,
  queryAsPlatformAdmin,
  queryAnon,
} from './db/with-context';

/**
 * Convenience: requirePromoter + run callback v RLS context jediným voláním.
 *
 * Použití v route handleru:
 *
 *   export async function GET(req: NextRequest) {
 *     return runAsPromoter(req, async (ctx) => {
 *       // Uvnitř ALS context — všechny `db().query()` calls automaticky
 *       // s SET LOCAL app.current_promoter_id = ctx.promoterId
 *       const r = await pool.query('SELECT * FROM catalog.events');
 *       return NextResponse.json(r.rows);
 *     });
 *   }
 *
 * Vrátí 401 pokud user není promoter member.
 */
import { NextResponse } from 'next/server';

export async function runAsPromoter<T>(
  req: NextRequest,
  callback: (ctx: PromoterContext) => Promise<T>,
): Promise<T | Response> {
  const ctx = await requirePromoter(req);
  if (!ctx) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }
  return runWithPromoterContext(ctx.promoterId, async () => callback(ctx));
}

/**
 * Jako runAsPromoter, ale navíc vyžaduje AKTIVNÍ promotér (status === 'active').
 * Pokrývá běžný admin vzor `if (!promoter || promoter.status !== 'active')`.
 * Pending/suspended promotér dostane 401 (nepustí dál).
 */
export async function runAsActivePromoter<T>(
  req: NextRequest,
  callback: (ctx: PromoterContext) => Promise<T>,
): Promise<T | Response> {
  const ctx = await requirePromoter(req);
  if (!ctx || ctx.status !== 'active') {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }
  return runWithPromoterContext(ctx.promoterId, async () => callback(ctx));
}

// ── Role-guarded varianty (zachovávají kontrolu role/status z původního preamble) ──
function rejectPromoter(): Response {
  return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
}

/** requirePromoter + role === 'owner' (vzor `!promoter || role !== 'owner'`). */
export async function runAsPromoterOwner<T>(
  req: NextRequest,
  callback: (ctx: PromoterContext) => Promise<T>,
): Promise<T | Response> {
  const ctx = await requirePromoter(req);
  if (!ctx) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  if (ctx.role !== 'owner') return rejectPromoter();
  return runWithPromoterContext(ctx.promoterId, async () => callback(ctx));
}

/** requirePromoter + role !== 'staff' (vzor `!promoter || role === 'staff'`). */
export async function runAsPromoterNonStaff<T>(
  req: NextRequest,
  callback: (ctx: PromoterContext) => Promise<T>,
): Promise<T | Response> {
  const ctx = await requirePromoter(req);
  if (!ctx) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  if (ctx.role === 'staff') return rejectPromoter();
  return runWithPromoterContext(ctx.promoterId, async () => callback(ctx));
}

/** active + role === 'owner'. */
export async function runAsActivePromoterOwner<T>(
  req: NextRequest,
  callback: (ctx: PromoterContext) => Promise<T>,
): Promise<T | Response> {
  const ctx = await requirePromoter(req);
  if (!ctx || ctx.status !== 'active') return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  if (ctx.role !== 'owner') return rejectPromoter();
  return runWithPromoterContext(ctx.promoterId, async () => callback(ctx));
}

/** active + role !== 'staff'. */
export async function runAsActivePromoterNonStaff<T>(
  req: NextRequest,
  callback: (ctx: PromoterContext) => Promise<T>,
): Promise<T | Response> {
  const ctx = await requirePromoter(req);
  if (!ctx || ctx.status !== 'active') return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  if (ctx.role === 'staff') return rejectPromoter();
  return runWithPromoterContext(ctx.promoterId, async () => callback(ctx));
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

  // membership lookup čte promoter_members (RLS) PŘED vznikem kontextu → service kontext
  const result = await runWithServiceContext(() =>
    rlsDb().query<{
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
    ),
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
