import { NextRequest, NextResponse } from 'next/server';
import { sendRsvpReminders } from '../../../../../jobs/rsvp-reminder.job.js';
import { getServiceContainer } from '../../../../../lib/service-container.js';

/**
 * POST /api/platform/admin/cron/rsvp-reminders
 * Cron endpoint to send RSVP reminders for upcoming events.
 * Expects header: x-cron-secret matching CRON_SECRET environment variable.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  // Verify cron secret
  const cronSecret = request.headers.get('x-cron-secret');
  if (cronSecret !== process.env.CRON_SECRET) {
    return NextResponse.json(
      { error: 'Unauthorized', code: 'UNAUTHORIZED' },
      { status: 401 },
    );
  }

  try {
    const { db, email } = getServiceContainer();
    const result = await sendRsvpReminders({ db, email }, 24);

    return NextResponse.json({
      success: true,
      data: result,
      message: `Sent ${result.sent} reminders, ${result.failed} failed.`,
    });
  } catch (err) {
    console.error('[rsvp-reminders cron] Error:', err);
    return NextResponse.json(
      {
        error: 'Failed to send reminders',
        code: 'INTERNAL_ERROR',
        details: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
