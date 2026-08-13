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
        // R-57: tady byval `SET LOCAL app.is_platform_admin = 'true'`. Byl
        // SPICI — mimo transakci PostgreSQL hlasi „SET LOCAL can only be used
        // in transaction blocks" a hodnota zustane prazdna (zmereno 3/3, §192),
        // a v cele route zadny BEGIN neni. Nic tedy nedelal, ale byl to
        // pripraveny vystup opravneni: kdyby `connect()` transakci otevrel
        // (kandidat (c) u R-56), kupujici GET by najednou bezel jako platform
        // admin. Odstraneno.
        //
        // Prava nechybi: `marketing.gift_vouchers` ma vetve
        // `app_is_platform_admin() OR promoter_id = …` a `app_is_service()`
        // (baseline :40620, :40945) — kupujici vetev zadnou. Routa proto stoji
        // na SERVISNIM kontextu z `runWithServiceContext` vyse a scopuje se
        // sama pres `WHERE fbi.user_id = $1`. Platform admin k tomu netreba.
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
