import { NextRequest, NextResponse } from 'next/server'
import { runAsPlatformAdmin } from '@/lib/platform-auth'
import { db } from '@/lib/db/rls-pool'

export const dynamic = 'force-dynamic'

interface SettleRow {
  partner_id: string
  settled_count: string
  total_amount: string
}

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }): Promise<Response> {
  const params = await props.params;
  const partnerId = params.id

  return runAsPlatformAdmin(req, async () => {
    const r = await db().query<SettleRow>(
      `WITH updated AS (
         UPDATE orders.reseller_sales
         SET settled_at = NOW()
         WHERE partner_id = $1 AND settled_at IS NULL
         RETURNING id, commission_amount_halire
       )
       SELECT $1::uuid AS partner_id,
              COUNT(id) AS settled_count,
              COALESCE(SUM(commission_amount_halire), 0) AS total_amount
       FROM updated`,
      [partnerId],
    )

    const row = r.rows[0]
    return NextResponse.json({
      settled: Number(row?.settled_count ?? 0),
      totalAmount: Number(row?.total_amount ?? 0),
    })
  })
}
