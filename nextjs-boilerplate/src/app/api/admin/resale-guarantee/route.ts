/**
 * Platform admin: resale guarantee claims management
 *
 * GET  /api/admin/resale-guarantee          — seznam claimů (pending first)
 * PATCH /api/admin/resale-guarantee/[id]    — resolve claim
 */

import { NextRequest, NextResponse } from 'next/server';
import { db, runWithPlatformAdminContext } from '@/lib/db/rls-pool';
import { runAsPlatformAdmin } from '@/lib/platform-auth';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

interface ClaimRow {
  id: string;
  resale_listing_id: string;
  buyer_order_id: string;
  reporter_user_id: string | null;
  reason: string;
  status: string;
  resolution: string | null;
  resolved_at: string | null;
  refund_amount_halire: number | null;
  created_at: string;
  reporter_email: string | null;
  event_title: string | null;
}

export async function GET(req: NextRequest): Promise<Response> {
  return runAsPlatformAdmin(req, async () => {
    const url = req.nextUrl;
    const status = url.searchParams.get('status');
    const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') ?? '50', 10)));
    const offset = (page - 1) * limit;

    const whereClause = status ? `WHERE c.status = $3` : '';
    const params: (string | number)[] = status
      ? [limit, offset, status]
      : [limit, offset];

    const rows = await runWithPlatformAdminContext(() =>
      db().query<ClaimRow>(
        `SELECT
           c.id,
           c.resale_listing_id,
           c.buyer_order_id,
           c.reporter_user_id,
           c.reason,
           c.status,
           c.resolution,
           c.resolved_at,
           c.refund_amount_halire,
           c.created_at,
           u.email AS reporter_email,
           e.title AS event_title
         FROM orders.resale_guarantee_claims c
         LEFT JOIN identity.users u ON u.id = c.reporter_user_id
         LEFT JOIN orders.orders o ON o.id = c.buyer_order_id
         LEFT JOIN catalog.events e ON e.id = o.event_id
         ${whereClause}
         ORDER BY
           CASE c.status WHEN 'pending' THEN 0 ELSE 1 END ASC,
           c.created_at DESC
         LIMIT $1 OFFSET $2`,
        params,
      ),
    );

    const countRes = await runWithPlatformAdminContext(() =>
      db().query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM orders.resale_guarantee_claims c ${whereClause}`,
        status ? [status] : [],
      ),
    );

    return NextResponse.json({
      claims: rows.rows,
      total: parseInt(countRes.rows[0]?.count ?? '0', 10),
      page,
      limit,
    });
  });
}

const patchSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(['approved', 'rejected']),
  resolution: z.string().min(1).max(1000).optional(),
  refundAmountHalire: z.number().int().min(0).optional(),
});

export async function PATCH(req: NextRequest): Promise<Response> {
  return runAsPlatformAdmin(req, async () => {
    const body = await req.json().catch(() => ({}));
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'VALIDATION_ERROR', issues: parsed.error.issues },
        { status: 400 },
      );
    }
    const { id, status, resolution, refundAmountHalire } = parsed.data;

    const result = await runWithPlatformAdminContext(() =>
      db().query<{ id: string }>(
        `UPDATE orders.resale_guarantee_claims
         SET status = $2,
             resolution = $3,
             refund_amount_halire = $4,
             resolved_at = NOW()
         WHERE id = $1 AND status = 'pending'
         RETURNING id`,
        [id, status, resolution ?? null, refundAmountHalire ?? null],
      ),
    );

    if (result.rows.length === 0) {
      return NextResponse.json(
        { error: 'CLAIM_NOT_FOUND', message: 'Claim nenalezen nebo již vyřešen.' },
        { status: 404 },
      );
    }

    return NextResponse.json({ ok: true, id });
  });
}
