/**
 * GET /api/admin/vat-rates — kódy sazeb DPH s procentem platným dnes (platform.vat_rates, migrace 494)
 * a zda je přihlášený pořadatel plátce DPH. Pro formuláře (kolo 7, C-54) — procenta nejsou v UI natvrdo.
 */
import { NextRequest, NextResponse } from 'next/server';
import { runAsPromoter } from '@/lib/admin-auth';
import { db } from '@/lib/db/rls-pool';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<Response> {
  return runAsPromoter(req, async (promoter) => {
    const payer = await db().query<{ vat_payer: boolean; company_dic: string | null }>(
      `SELECT vat_payer, company_dic FROM platform.promoters WHERE id = $1`,
      [promoter.promoterId],
    );
    const codes = await db().query<{ code: string; label: string; rate_pct: string | null }>(
      `SELECT c.code, c.label, platform.vat_rate_at(c.code, CURRENT_DATE)::text AS rate_pct
         FROM platform.vat_rate_codes c ORDER BY c.code`,
    );
    return NextResponse.json({
      vatPayer: payer.rows[0]?.vat_payer ?? true,
      hasDic: !!payer.rows[0]?.company_dic,
      codes: codes.rows.map((c) => ({ code: c.code, label: c.label, ratePct: c.rate_pct === null ? null : Number(c.rate_pct) })),
    });
  });
}
