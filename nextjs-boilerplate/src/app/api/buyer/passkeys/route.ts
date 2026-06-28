/**
 * GET    /api/buyer/passkeys   — seznam passkeys přihlášeného uživatele
 * DELETE /api/buyer/passkeys   — smaž passkey dle { id } v těle
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsUser } from '@/lib/auth';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<Response> {
  return runAsUser(req, async (userId) => {
    const rows = await db().query<{
      id:                 string;
      device_name:        string | null;
      transports:         string[] | null;
      is_backup_eligible: boolean;
      is_backup_state:    boolean;
      last_used_at:       string | null;
      created_at:         string;
    }>(
      `SELECT id, device_name, transports,
              is_backup_eligible, is_backup_state,
              last_used_at, created_at
       FROM identity.webauthn_credentials
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [userId],
    );

    return NextResponse.json({
      passkeys: rows.rows.map((r) => ({
        id:              r.id,
        deviceName:      r.device_name ?? 'Passkey',
        transports:      r.transports ?? [],
        isSynced:        r.is_backup_eligible && r.is_backup_state,
        lastUsedAt:      r.last_used_at,
        createdAt:       r.created_at,
      })),
    });
  });
}

const deleteSchema = z.object({ id: z.string().uuid() });

export async function DELETE(req: NextRequest): Promise<Response> {
  return runAsUser(req, async (userId) => {
    const body   = await req.json().catch(() => null);
    const parsed = deleteSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'INVALID_BODY' }, { status: 422 });
    }

    // Ověř, že má user alespoň 1 jiný způsob přihlášení (email+heslo nebo jiný passkey)
    const other = await db().query<{ cnt: string }>(
      `SELECT (
         (SELECT COUNT(*) FROM identity.webauthn_credentials
          WHERE user_id = $1 AND id != $2)
         +
         (SELECT COUNT(*) FROM identity.users
          WHERE id = $1 AND password_hash IS NOT NULL)
       )::text AS cnt`,
      [userId, parsed.data.id],
    );
    if (Number(other.rows[0]?.cnt ?? 0) === 0) {
      return NextResponse.json(
        { error: 'LAST_AUTH_METHOD', detail: 'Nejprve si nastavte heslo.' },
        { status: 409 },
      );
    }

    const del = await db().query(
      `DELETE FROM identity.webauthn_credentials WHERE id = $1 AND user_id = $2`,
      [parsed.data.id, userId],
    );
    if ((del.rowCount ?? 0) === 0) {
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  });
}
