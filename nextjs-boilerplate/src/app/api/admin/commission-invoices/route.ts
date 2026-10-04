/** GET /api/admin/commission-invoices — faktury provize platformy vystavené přihlášenému pořadateli. Kolo 7, C-54. */
import { NextRequest, NextResponse } from 'next/server';
import { runAsPromoterNonStaff } from '@/lib/admin-auth';
import { db } from '@/lib/db/rls-pool';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<Response> {
  return runAsPromoterNonStaff(req, async (promoter) => {
    const r = await db().query(
      `SELECT id, invoice_number, issue_date::text, taxable_supply_date::text, total_minor::int AS total_minor,
              vat_minor::int AS vat_minor, currency, payout_id
         FROM platform.commission_invoices WHERE promoter_id = $1
        ORDER BY issue_date DESC, invoice_number DESC`,
      [promoter.promoterId],
    );
    return NextResponse.json({ invoices: r.rows });
  });
}
