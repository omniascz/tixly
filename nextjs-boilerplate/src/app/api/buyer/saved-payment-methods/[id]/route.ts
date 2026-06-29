import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsUser } from '@/lib/auth';

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  return runAsUser(req, async (userId) => {
    const r = await db().query(
      `DELETE FROM identity.saved_payment_methods WHERE id = $1 AND user_id = $2`,
      [params.id, userId],
    );
    if ((r.rowCount ?? 0) === 0) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  return runAsUser(req, async (userId) => {
    const client = await db().connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE identity.saved_payment_methods SET is_default = false WHERE user_id = $1`,
        [userId],
      );
      const r = await client.query(
        `UPDATE identity.saved_payment_methods SET is_default = true WHERE id = $1 AND user_id = $2`,
        [params.id, userId],
      );
      if ((r.rowCount ?? 0) === 0) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
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
