// ---------------------------------------------------------------------------
// POST /api/campaigns/:id/preview — preview segment size and sample recipients
// ---------------------------------------------------------------------------

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  getCampaign,
  getRecipientSegment,
  type DbAdapter,
} from '../../../../../services/campaign.service.js';
import {
  getSegmentSize,
  getSampleRecipients,
} from '../../../../../services/segmentation.service.js';
import type { SegmentRule } from '../../../../../lib/types.js';

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const SegmentRuleSchema = z.object({
  type: z.enum(['event_type', 'geography', 'age', 'purchase_history', 'engagement_level']),
  operator: z.enum(['equals', 'in', 'gte', 'lte', 'between']),
  values: z.array(z.union([z.string(), z.number()])).min(1),
});

const PreviewRequestSchema = z.object({
  segmentRules: z.array(SegmentRuleSchema).default([]),
});

// ---------------------------------------------------------------------------
// Stub DB adapter
// ---------------------------------------------------------------------------

const db = {} as DbAdapter;

// Mock promoter auth
const PROMOTER_ID = 'promoter-001';

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = PreviewRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation error', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    // Verify campaign ownership
    const campaign = await getCampaign(params.id, db);
    if (campaign.promoterId !== PROMOTER_ID) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const { segmentRules } = parsed.data;

    // Get segment size (for UI preview)
    const segmentSize = await getSegmentSize(PROMOTER_ID, segmentRules as SegmentRule[], db);

    // Get sample recipients (up to 3)
    const exampleRecipients = await getSampleRecipients(
      PROMOTER_ID,
      segmentRules as SegmentRule[],
      db,
      3,
    );

    return NextResponse.json({
      segmentSize,
      exampleRecipients,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';

    if (message.startsWith('NOT_FOUND:')) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
    }

    console.error('POST /api/campaigns/:id/preview error:', error);
    return NextResponse.json(
      { error: 'Failed to generate preview' },
      { status: 500 },
    );
  }
}
