// ---------------------------------------------------------------------------
// GET /api/campaigns — list campaigns for promoter
// POST /api/campaigns — create new campaign
// ---------------------------------------------------------------------------

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  createCampaign,
  listCampaigns,
  type DbAdapter,
  type BulkGateClient,
} from '../../../services/campaign.service.js';
import type { SegmentRule } from '../../../lib/types.js';

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const SegmentRuleSchema = z.object({
  type: z.enum(['event_type', 'geography', 'age', 'purchase_history', 'engagement_level']),
  operator: z.enum(['equals', 'in', 'gte', 'lte', 'between']),
  values: z.array(z.union([z.string(), z.number()])).min(1),
});

const CreateCampaignSchema = z.object({
  name: z.string().min(1, 'name is required').max(255),
  type: z.enum(['informational', 'promotional']),
  body: z.string().min(1, 'body is required').max(160, 'body cannot exceed 160 characters'),
  segmentRules: z.array(SegmentRuleSchema).default([]),
});

// ---------------------------------------------------------------------------
// Stub DB/BulkGate adapters — replace with your real implementation
// ---------------------------------------------------------------------------

const db = {} as DbAdapter;
const bulkGate = {} as BulkGateClient;

// Mock promoter auth — in production, extract from JWT/session
const PROMOTER_ID = 'promoter-001';

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const searchParams = request.nextUrl.searchParams;
    const limit = Math.min(parseInt(searchParams.get('limit') ?? '20', 10), 100);
    const offset = Math.max(parseInt(searchParams.get('offset') ?? '0', 10), 0);

    const { campaigns, total } = await listCampaigns(PROMOTER_ID, db, limit, offset);

    return NextResponse.json({
      campaigns,
      pagination: {
        limit,
        offset,
        total,
        hasMore: offset + limit < total,
      },
    });
  } catch (error) {
    console.error('GET /api/campaigns error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch campaigns' },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = CreateCampaignSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation error', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const { name, type, body: smsBody, segmentRules } = parsed.data;

    const campaign = await createCampaign(
      PROMOTER_ID,
      name,
      type,
      smsBody,
      segmentRules as SegmentRule[],
      db,
    );

    return NextResponse.json(
      {
        id: campaign.id,
        status: campaign.status,
        name: campaign.name,
      },
      { status: 201 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';

    if (message.startsWith('VALIDATION_ERROR:')) {
      return NextResponse.json(
        { error: message.replace('VALIDATION_ERROR: ', '') },
        { status: 400 },
      );
    }

    console.error('POST /api/campaigns error:', error);
    return NextResponse.json(
      { error: 'Failed to create campaign' },
      { status: 500 },
    );
  }
}
