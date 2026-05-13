import { NextRequest, NextResponse } from 'next/server';
import {
  getMonthlyLeaderboard,
} from '../../../../services/leaderboard.service';
import { getServiceDeps } from '../../../../lib/service-container.js';

// ============================================================
// GET /api/referral/leaderboard?year=2026&month=4&limit=10
//
// Public endpoint — no authentication required.
// Response cached for 5 minutes (CDN + browser).
// ============================================================

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(req.url);

  const yearParam = searchParams.get('year');
  const monthParam = searchParams.get('month');
  const limitParam = searchParams.get('limit') ?? '10';

  const now = new Date();
  const year = yearParam ? parseInt(yearParam, 10) : now.getUTCFullYear();
  const month = monthParam ? parseInt(monthParam, 10) : now.getUTCMonth() + 1;
  const limit = Math.min(Math.max(parseInt(limitParam, 10) || 10, 1), 100);

  if (
    isNaN(year) || year < 2020 || year > 2100 ||
    isNaN(month) || month < 1 || month > 12
  ) {
    return NextResponse.json(
      { error: 'Invalid year or month parameter' },
      { status: 400 },
    );
  }

  try {
    const { db } = getServiceDeps();
    const leaderboard = await getMonthlyLeaderboard(year, month, limit, db);

    return NextResponse.json(
      {
        leaderboard,
        year,
        month,
        updatedAt: new Date().toISOString(),
      },
      {
        headers: {
          'Cache-Control': 'public, max-age=300, s-maxage=300',
        },
      },
    );
  } catch (err) {
    console.error('[GET /api/referral/leaderboard]', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
