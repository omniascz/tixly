// gamification/src/app/api/users/[userId]/badges/route.ts — GET user's earned badges
// Returns only earned badges with earnedAt timestamps (privacy-respecting).

import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@tixly/rls-multitenancy';
import { getBadgesForUser } from '../../../services/badge.service';

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
    const badges = await getBadgesForUser(userId, db);

    return NextResponse.json(badges, { status: 200 });
  } catch (error) {
    console.error('Failed to fetch user badges:', error);
    return NextResponse.json(
      { error: 'Failed to fetch user badges' },
      { status: 500 },
    );
  }
}
