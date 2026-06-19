import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { SignJWT } from 'jose';
import { db } from '@/lib/db/rls-pool';

function getSecretKey(): Uint8Array {
  let secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('JWT_SECRET missing or too short in production');
    }
    secret = 'dev-secret-change-me-min-32-chars-please';
  }
  return new TextEncoder().encode(secret);
}

const schema = z.object({
  inviteToken: z.string().min(10),
});

export async function POST(req: NextRequest): Promise<Response> {
  const body: unknown = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 422 });
  }

  const client = await db().connect();
  try {
    await client.query('BEGIN');

    const res = await client.query<{
      user_id: string;
      account_id: string;
      is_admin: boolean;
      email: string;
      name: string;
      company_name: string;
      account_code: string;
    }>(
      `SELECT bau.id AS user_id, bau.account_id, bau.is_admin, bau.email, bau.name,
              ba.company_name, ba.account_code
       FROM platform.b2b_account_users bau
       JOIN platform.b2b_accounts ba ON ba.id = bau.account_id
       WHERE bau.invite_token = $1 AND bau.joined_at IS NULL`,
      [parsed.data.inviteToken],
    );

    if (res.rows.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'INVITE_TOKEN_INVALID' }, { status: 401 });
    }

    const row = res.rows[0];

    await client.query(
      `UPDATE platform.b2b_account_users
       SET joined_at = NOW(), invite_token = NULL
       WHERE id = $1`,
      [row.user_id],
    );

    await client.query('COMMIT');

    const token = await new SignJWT({
      b2bAccountId: row.account_id,
      b2bUserId: row.user_id,
      isAdmin: row.is_admin,
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('90d')
      .sign(getSecretKey());

    return NextResponse.json({ token, companyName: row.company_name, accountCode: row.account_code });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[b2b/account/login]', err);
    return NextResponse.json({ error: 'INTERNAL_SERVER_ERROR' }, { status: 500 });
  } finally {
    client.release();
  }
}
