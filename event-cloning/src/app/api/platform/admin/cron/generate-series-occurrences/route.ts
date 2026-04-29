import { NextRequest, NextResponse } from 'next/server'
import { generateAllSeries } from '../../../../../../services/recurring-events.service.js'
import { getServiceDeps } from '../../../../../../lib/service-container.js'

/**
 * POST /api/platform/admin/cron/generate-series-occurrences
 *
 * Cron entry point: iterates all active recurring series and materialises any
 * new occurrences inside each series' publish window.
 */
export async function POST(_request: NextRequest): Promise<NextResponse> {
  try {
    const { db } = getServiceDeps()
    const result = await generateAllSeries(db)
    return NextResponse.json(result, { status: 200 })
  } catch (err) {
    console.error('[cron generate-series-occurrences]', err)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Interní chyba serveru.' } },
      { status: 500 },
    )
  }
}
