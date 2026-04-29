// ---------------------------------------------------------------------------
// POST /api/campaigns/:id/publish — schedule or immediately send campaign
// ---------------------------------------------------------------------------

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  publishCampaign,
  getCampaign,
  getRecipientSegment,
  type DbAdapter,
} from '../../../../../services/campaign.service.js';

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const PublishRequestSchema = z.object({
  scheduledAt: z.string().datetime('Invalid ISO 8601 timestamp'),
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

  const parsed = PublishRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation error', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    // Verify ownership
    const campaign = await getCampaign(params.id, db);
    if (campaign.promoterId !== PROMOTER_ID) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const { scheduledAt } = parsed.data;

    // Get recipient count for validation
    const recipients = await getRecipientSegment(campaign.promoterId, campaign.segmentRules, db);
    if (recipients.length === 0) {
      return NextResponse.json(
        { error: 'No recipients match campaign segment rules' },
        { status: 400 },
      );
    }

    // Publish campaign
    const published = await publishCampaign(params.id, scheduledAt, db);

    return NextResponse.json({
      id: published.id,
      status: published.status,
      scheduledAt: published.scheduledAt,
      recipientCount: recipients.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';

    if (message.startsWith('NOT_FOUND:')) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
    }

    if (message.startsWith('VALIDATION_ERROR:')) {
      return NextResponse.json(
        { error: message.replace('VALIDATION_ERROR: ', '') },
        { status: 400 },
      );
    }

    console.error('POST /api/campaigns/:id/publish error:', error);
    return NextResponse.json(
      { error: 'Failed to publish campaign' },
      { status: 500 },
    );
  }
}
