/**
 * POST /api/buyer/resale/list/[id]/cancel
 *
 * Stáhne aktivní listing. Ověří, že žadatel je seller (přes x-user-id NEBO
 * ownerEmail v body — guest cesta).
 */

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { z } from 'zod';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

const schema = z
  .object({
    ownerEmail: z.string().email().optional(),
  })
  .optional();

interface ListingRow {
  id: string;
  seller_id: string;
  status: string;
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 422 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed' }, { status: 422 });
  }
  const ownerEmail = parsed.data?.ownerEmail;
  const headerUserId = req.headers.get('x-user-id');

  // Resolve userId
  let userId: string | null = headerUserId;
  if (!userId && ownerEmail) {
    const u = await db().query<{ id: string }>(
      `SELECT id FROM identity.users WHERE email = $1 AND anonymized_at IS NULL LIMIT 1`,
      [ownerEmail.toLowerCase()],
    );
    if (u.rows.length === 0) {
      return NextResponse.json({ error: 'Owner not found' }, { status: 404 });
    }
    userId = u.rows[0].id;
  }
  if (!userId) {
    return NextResponse.json({ error: 'Auth required' }, { status: 401 });
  }

  const client = await db().connect();
  try {
    await client.query('BEGIN');
    const r = await client.query<ListingRow>(
      `SELECT id, seller_id, status FROM resale.resale_listings
       WHERE id = $1 FOR UPDATE`,
      [params.id],
    );
    if (r.rows.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Listing not found' }, { status: 404 });
    }
    const listing = r.rows[0];
    if (listing.seller_id !== userId) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Not the seller' }, { status: 403 });
    }
    if (listing.status !== 'active') {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: `Listing status is "${listing.status}", cannot cancel` },
        { status: 409 },
      );
    }
    await client.query(
      `UPDATE resale.resale_listings
       SET status = 'cancelled', cancelled_at = NOW()
       WHERE id = $1`,
      [params.id],
    );
    await client.query('COMMIT');
    return NextResponse.json({ ok: true, listingId: params.id });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[POST /api/buyer/resale/list/[id]/cancel]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  } finally {
    client.release();
  }
}
