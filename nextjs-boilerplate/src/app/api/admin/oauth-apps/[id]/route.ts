/**
 * PATCH/DELETE /api/admin/oauth-apps/[id]
 *
 * Update app metadata nebo suspend/revoke client.
 */
import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { z } from 'zod';
import { requirePromoter } from '@/lib/admin-auth';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

const patchSchema = z.object({
  appName: z.string().min(2).max(200).optional(),
  appDescription: z.string().max(2000).nullable().optional(),
  redirectUris: z.array(z.string().url()).min(1).max(10).optional(),
  status: z.enum(['active', 'suspended', 'revoked']).optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  const promoter = await requirePromoter(req);
  if (!promoter || promoter.role === 'staff') {
    return NextResponse.json({ error: 'ADMIN_OR_OWNER_ONLY' }, { status: 403 });
  }

  const body: unknown = await req.json().catch(() => ({}));
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_BODY' }, { status: 422 });

  const updates: string[] = [];
  const args: unknown[] = [params.id, promoter.promoterId];
  function add(col: string, val: unknown) {
    args.push(val);
    updates.push(`${col} = $${args.length}`);
  }
  if (parsed.data.appName !== undefined) add('app_name', parsed.data.appName);
  if (parsed.data.appDescription !== undefined) add('app_description', parsed.data.appDescription);
  if (parsed.data.redirectUris !== undefined) add('redirect_uris', parsed.data.redirectUris);
  if (parsed.data.status !== undefined) add('status', parsed.data.status);

  if (updates.length === 0) return NextResponse.json({ ok: true, noop: true });

  const r = await db().query(
    `UPDATE b2b.oauth_clients
        SET ${updates.join(', ')}, updated_at = now()
      WHERE id = $1 AND owner_promoter_id = $2
    RETURNING id`,
    args,
  );

  // Pokud status = revoked, revoknout všechny aktivní tokeny
  if (parsed.data.status === 'revoked' && r.rows.length > 0) {
    await db().query(
      `UPDATE b2b.oauth_access_tokens SET revoked_at = now()
        WHERE client_id = $1 AND revoked_at IS NULL`,
      [params.id],
    );
    await db().query(
      `UPDATE b2b.oauth_refresh_tokens SET revoked_at = now()
        WHERE client_id = $1 AND revoked_at IS NULL`,
      [params.id],
    );
  }

  if (r.rows.length === 0) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  const promoter = await requirePromoter(req);
  if (!promoter || promoter.role === 'staff') {
    return NextResponse.json({ error: 'ADMIN_OR_OWNER_ONLY' }, { status: 403 });
  }

  const r = await db().query(
    `DELETE FROM b2b.oauth_clients WHERE id = $1 AND owner_promoter_id = $2 RETURNING id`,
    [params.id, promoter.promoterId],
  );
  if (r.rows.length === 0) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  return NextResponse.json({ deleted: true });
}
