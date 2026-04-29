// gamification/src/app/api/badges/route.ts — GET all badge definitions
// Returns available badges with unlock criteria for frontend display.

import { NextRequest, NextResponse } from 'next/server';
import { defineBadges } from '../../services/badge.service';

export async function GET(request: NextRequest) {
  try {
    const badges = defineBadges();

    const response = badges.map((badge) => ({
      id: badge.id,
      badgeType: badge.badgeType,
      name: badge.name,
      description: badge.description,
      icon: badge.icon,
      displayColor: badge.displayColor,
      tier: badge.tier,
      criteria: {
        type: badge.criteria.type,
        threshold: badge.criteria.threshold,
        daysBeforeEvent: badge.criteria.daysBeforeEvent,
        consecutiveMonths: badge.criteria.consecutiveMonths,
        hint: badge.criteria.hint,
      },
    }));

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    console.error('Failed to fetch badge definitions:', error);
    return NextResponse.json(
      { error: 'Failed to fetch badge definitions' },
      { status: 500 },
    );
  }
}
