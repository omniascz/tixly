/**
 * GET  /api/platform/identity-verifications?status=pending   — admin seznam žádostí
 * PATCH /api/platform/identity-verifications?id=<uuid>       — approve / reject
 */
import { NextRequest, NextResponse } from 'next/server';
import { db, runWithPlatformAdminContext } from '@/lib/db/rls-pool';
import { requirePlatformAdmin } from '@/lib/platform-auth';
import { z } from 'zod';

const patchSchema = z.object({
  action: z.enum(['approve', 'reject']),
  notes: z.string().max(500).optional(),
});

export async function GET(req: NextRequest): Promise<Response> {
  const admin = await requirePlatformAdmin(req);
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const status = req.nextUrl.searchParams.get('status') ?? 'pending';

  return runWithPlatformAdminContext(async () => {
    const r = await db().query(
      `SELECT iv.id, iv.user_id, iv.legal_name, iv.document_type, iv.status,
              iv.submitted_at, iv.reviewed_at, iv.reviewer_notes,
              u.email, u.name AS user_name, u.fan_id_verified
         FROM orders.identity_verifications iv
         JOIN identity.users u ON u.id = iv.user_id
        WHERE ($1 = 'all' OR iv.status = $1)
        ORDER BY iv.submitted_at ASC
        LIMIT 200`,
      [status],
    );
    return NextResponse.json({ verifications: r.rows });
  });
}

export async function PATCH(req: NextRequest): Promise<Response> {
  const admin = await requirePlatformAdmin(req);
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 422 });

  const body: unknown = await req.json().catch(() => ({}));
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'BAD_INPUT', issues: parsed.error.issues }, { status: 422 });
  }

  return runWithPlatformAdminContext(async () => {
    const client = await db().connect();
    try {
      await client.query('BEGIN');

      const r = await client.query<{ user_id: string; status: string }>(
        `UPDATE orders.identity_verifications
            SET status = $1, reviewed_at = NOW(), reviewer_notes = $2, reviewed_by_id = $3
          WHERE id = $4 AND status = 'pending'
          RETURNING user_id, status`,
        [parsed.data.action === 'approve' ? 'approved' : 'rejected', parsed.data.notes ?? null, admin.userId, id],
      );

      if ((r.rowCount ?? 0) === 0) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'NOT_FOUND_OR_ALREADY_REVIEWED' }, { status: 404 });
      }

      if (parsed.data.action === 'approve') {
        await client.query(
          `UPDATE identity.users SET fan_id_verified = true, fan_id_verified_at = NOW() WHERE id = $1`,
          [r.rows[0].user_id],
        );
      }

      await client.query('COMMIT');
      return NextResponse.json({ ok: true });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  });
}
