import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsUser } from '@/lib/auth';

interface SavedMethodRow {
  id: string;
  card_mask: string | null;
  card_brand: string | null;
  expires_month: number | null;
  expires_year: number | null;
  is_default: boolean;
  created_at: string;
}

export async function GET(req: NextRequest): Promise<Response> {
  return runAsUser(req, async (userId) => {
    const r = await db().query<SavedMethodRow>(
      `SELECT id, card_mask, card_brand, expires_month, expires_year, is_default, created_at
       FROM identity.saved_payment_methods
       WHERE user_id = $1
       ORDER BY is_default DESC, created_at DESC`,
      [userId],
    );
    return NextResponse.json({ methods: r.rows });
  });
}
