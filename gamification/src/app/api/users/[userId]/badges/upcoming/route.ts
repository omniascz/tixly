// gamification/src/app/api/users/[userId]/badges/upcoming/route.ts — GET upcoming badges
// Returns badges user is close to earning with progress percentage.

import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@tixly/rls-multitenancy';
import { getBadgesUpcoming } from '../../../../services/badge.service';

export async function GET(
  request: NextRequest,
  { params }: { params: { userId: string } },
) {
  try {
    const userId = params.userId;

    if (!userId) {
      return NextResponse.json(
        { error: 'User ID is required' },
        { status: 400 },
      );
    }

    const db = getDatabase();
    const upcomingBadges = await getBadgesUpcoming(userId, db);

    return NextResponse.json(upcomingBadges, { status: 200 });
  } catch (error) {
    console.error('Failed to fetch upcoming badges:', error);
    return NextResponse.json(
      { error: 'Failed to fetch upcoming badges' },
      { status: 500 },
    );
  }
}
