// gamification/src/app/api/users/[userId]/stats/route.ts — GET user's gamification stats
// Returns complete gamification data: badges, tickets, events, streak, next badge hint.

import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@tixly/rls-multitenancy';
import { getGameificationStats } from '../../../services/badge.service';

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
    const stats = await getGameificationStats(userId, db);

    return NextResponse.json(stats, { status: 200 });
  } catch (error) {
    console.error('Failed to fetch gamification stats:', error);
    return NextResponse.json(
      { error: 'Failed to fetch gamification stats' },
      { status: 500 },
    );
  }
}
