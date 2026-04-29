import { NextRequest, NextResponse } from 'next/server';
import { PostEventReportService } from '../../../../services/post-event-report.service';
import type { ReportDbAdapter } from '../../../../services/post-event-report.service';

/**
 * GET /api/organizer/reports
 * List all post-event reports for authenticated organizer
 * Returns array of PostEventReportSummary objects
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    // TODO: Get organizer ID from authenticated session
    const organizerId = request.headers.get('x-organizer-id');
    if (!organizerId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // TODO: Inject database adapter from your application context
    const db: ReportDbAdapter = null as any; // Inject from context

    const service = new PostEventReportService();
    const reports = await service.listReports(organizerId, db);

    return NextResponse.json(reports);
  } catch (error) {
    console.error('[GET /api/organizer/reports] Error:', error);
    return NextResponse.json(
      { error: 'Failed to retrieve reports' },
      { status: 500 }
    );
  }
}
