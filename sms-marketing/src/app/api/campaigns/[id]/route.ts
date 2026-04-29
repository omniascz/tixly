// ---------------------------------------------------------------------------
// GET /api/campaigns/:id — get campaign details with stats
// PATCH /api/campaigns/:id — update campaign (only if not sent)
// DELETE /api/campaigns/:id — soft delete (archive) campaign
// ---------------------------------------------------------------------------

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  getCampaign,
  updateCampaign,
  deleteCampaign,
  type DbAdapter,
} from '../../../../services/campaign.service.js';
import type { SegmentRule } from '../../../../lib/types.js';

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const SegmentRuleSchema = z.object({
  type: z.enum(['event_type', 'geography', 'age', 'purchase_history', 'engagement_level']),
  operator: z.enum(['equals', 'in', 'gte', 'lte', 'between']),
  values: z.array(z.union([z.string(), z.number()])).min(1),
});

const UpdateCampaignSchema = z.object({
  name: z.string().max(255).optional(),
  type: z.enum(['informational', 'promotional']).optional(),
  body: z.string().min(1).max(160, 'body cannot exceed 160 characters').optional(),
  segmentRules: z.array(SegmentRuleSchema).optional(),
});

// ---------------------------------------------------------------------------
// Stub DB adapter
// ---------------------------------------------------------------------------

const db = {} as DbAdapter;

// Mock promoter auth
const PROMOTER_ID = 'promoter-001';

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  try {
    const campaign = await getCampaign(params.id, db);

    // Verify ownership
    if (campaign.promoterId !== PROMOTER_ID) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    return NextResponse.json(campaign);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';

    if (message.startsWith('NOT_FOUND:')) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
    }

    console.error('GET /api/campaigns/:id error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch campaign' },
      { status: 500 },
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = UpdateCampaignSchema.safeParse(body);
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

    const updated = await updateCampaign(params.id, parsed.data as any, db);

    return NextResponse.json(updated);
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

    console.error('PATCH /api/campaigns/:id error:', error);
    return NextResponse.json(
      { error: 'Failed to update campaign' },
      { status: 500 },
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  try {
    // Verify ownership
    const campaign = await getCampaign(params.id, db);
    if (campaign.promoterId !== PROMOTER_ID) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    await deleteCampaign(params.id, db);

    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';

    if (message.startsWith('NOT_FOUND:')) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
    }

    console.error('DELETE /api/campaigns/:id error:', error);
    return NextResponse.json(
      { error: 'Failed to delete campaign' },
      { status: 500 },
    );
  }
}
