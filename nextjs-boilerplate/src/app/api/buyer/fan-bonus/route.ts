/**
 * GET /api/buyer/fan-bonus
 * Vrátí historii FanBonus kreditů pro přihlášeného kupujícího.
 */

import { NextRequest, NextResponse } from 'next/server';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';
import { runAsUser } from '@/lib/auth';
import { getFanBonusHistory } from '@/lib/fan-bonus/engine';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<Response> {
  return runAsUser(req, async (userId) => {
    return runWithServiceContext(async () => {
      const client = await db().connect();
      try {
        await client.query(`SET LOCAL app.is_platform_admin = 'true'`);

        const history = await getFanBonusHistory(client, userId);

        const totalAvailable = history
          .filter((h) => h.balanceHalire > 0)
          .reduce((sum, h) => sum + h.balanceHalire, 0);

        return NextResponse.json({ totalAvailable, history });
      } finally {
        client.release();
      }
    });
  });
}
