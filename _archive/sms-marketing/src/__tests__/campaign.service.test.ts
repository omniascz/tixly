import { describe, it, expect, vi } from 'vitest';
import {
  createCampaign,
  publishCampaign,
  executeCampaignSend,
  getCampaign,
  updateCampaign,
  deleteCampaign,
  listCampaigns,
  getRecipientSegment,
  updateCampaignStats,
  type DbAdapter,
  type BulkGateClient,
} from '../services/campaign.service.js';
import type { SegmentRule } from '../lib/types.js';

// =============================================================================
// Test fixtures
// =============================================================================

const PROMOTER_ID = 'promoter-001';
const CAMPAIGN_ID = 'camp-001';
const USER_ID = 'user-001';

function makeCampaignRow(overrides: Record<string, unknown> = {}) {
  return {
    id: CAMPAIGN_ID,
    promoter_id: PROMOTER_ID,
    name: 'Summer Sale',
    type: 'promotional',
    body: 'Get 30% off all tickets this summer!',
    segment_rules: JSON.stringify([
      { type: 'event_type', operator: 'equals', values: ['concert'] },
    ]),
    scheduled_at: null,
    sent_at: null,
    status: 'pending',
    created_at: '2026-04-18T10:00:00Z',
    updated_at: '2026-04-18T10:00:00Z',
    ...overrides,
  };
}

function makeStatRow(overrides: Record<string, unknown> = {}) {
  return {
    campaign_id: CAMPAIGN_ID,
    sent_count: 0,
    failed_count: 0,
    bounced_count: 0,
    click_count: 0,
    unsubscribe_count: 0,
    ...overrides,
  };
}

function makeDb(queryResults: unknown[][] = []): DbAdapter {
  let callIdx = 0;

  const queryFn = vi.fn(async () => {
    const result = queryResults[callIdx] ?? [];
    callIdx++;
    return result;
  });

  const executeFn = vi.fn();

  function makeAdapter(): DbAdapter {
    return {
      query: queryFn,
      execute: executeFn,
      transaction: vi.fn(async (fn) => fn(makeAdapter())),
    };
  }

  return makeAdapter();
}

function makeBulkGate(result?: any): BulkGateClient {
  return {
    sendBulk: vi.fn(async () => result || { accepted: ['phone1', 'phone2'], rejected: [] }),
  };
}

// =============================================================================
// Tests: Campaign creation and validation
// =============================================================================

describe('createCampaign', () => {
  it('creates campaign with valid input', async () => {
    const db = makeDb([
      [makeCampaignRow()],
      [makeStatRow()],
    ]);

    const campaign = await createCampaign(
      PROMOTER_ID,
      'Summer Sale',
      'promotional',
      'Get 30% off!',
      [{ type: 'event_type', operator: 'equals', values: ['concert'] }],
      db,
    );

    expect(campaign.name).toBe('Summer Sale');
    expect(campaign.type).toBe('promotional');
    expect(campaign.status).toBe('pending');
  });

  it('rejects body exceeding 160 characters', async () => {
    const db = makeDb();
    const longBody = 'a'.repeat(161);

    await expect(
      createCampaign(PROMOTER_ID, 'Test', 'informational', longBody, [], db),
    ).rejects.toThrow('exceeds 160 characters');
  });

  it('rejects empty body', async () => {
    const db = makeDb();

    await expect(
      createCampaign(PROMOTER_ID, 'Test', 'informational', '', [], db),
    ).rejects.toThrow('cannot be empty');
  });

  it('rejects invalid segment rule type', async () => {
    const db = makeDb();

    await expect(
      createCampaign(PROMOTER_ID, 'Test', 'informational', 'Hi', [
        { type: 'invalid' as any, operator: 'equals', values: ['x'] },
      ], db),
    ).rejects.toThrow('Invalid segment type');
  });

  it('rejects invalid segment operator', async () => {
    const db = makeDb();

    await expect(
      createCampaign(PROMOTER_ID, 'Test', 'informational', 'Hi', [
        { type: 'event_type', operator: 'invalid' as any, values: ['x'] },
      ], db),
    ).rejects.toThrow('Invalid segment operator');
  });

  it('rejects segment rule with no values', async () => {
    const db = makeDb();

    await expect(
      createCampaign(PROMOTER_ID, 'Test', 'informational', 'Hi', [
        { type: 'event_type', operator: 'equals', values: [] },
      ], db),
    ).rejects.toThrow('at least one value');
  });
});

// =============================================================================
// Tests: Campaign publishing
// =============================================================================

describe('publishCampaign', () => {
  it('publishes to "sent" if scheduled time is in past', async () => {
    const pastTime = new Date(Date.now() - 3600000).toISOString();
    const db = makeDb([
      [makeCampaignRow()],
      [makeCampaignRow({ status: 'sent', scheduled_at: pastTime, sent_at: pastTime })],
      [makeStatRow()],
    ]);

    const campaign = await publishCampaign(CAMPAIGN_ID, pastTime, db);

    expect(campaign.status).toBe('sent');
  });

  it('publishes to "scheduled" if scheduled time is in future', async () => {
    const futureTime = new Date(Date.now() + 3600000).toISOString();
    const db = makeDb([
      [makeCampaignRow()],
      [makeCampaignRow({ status: 'scheduled', scheduled_at: futureTime })],
      [makeStatRow()],
    ]);

    const campaign = await publishCampaign(CAMPAIGN_ID, futureTime, db);

    expect(campaign.status).toBe('scheduled');
  });

  it('rejects publishing already-sent campaign', async () => {
    const db = makeDb([
      [makeCampaignRow({ status: 'sent' })],
    ]);

    await expect(
      publishCampaign(CAMPAIGN_ID, new Date().toISOString(), db),
    ).rejects.toThrow('Cannot republish');
  });

  it('throws NOT_FOUND for missing campaign', async () => {
    const db = makeDb([[]]);

    await expect(
      publishCampaign('missing-id', new Date().toISOString(), db),
    ).rejects.toThrow('NOT_FOUND');
  });
});

// =============================================================================
// Tests: Campaign execution/sending
// =============================================================================

describe('executeCampaignSend', () => {
  it('sends to all recipients in batches', async () => {
    const db = makeDb([
      [makeCampaignRow({ status: 'scheduled', scheduled_at: new Date(Date.now() - 1000).toISOString() })],
      [
        { id: USER_ID, phone: '+420722123456' },
        { id: 'user-002', phone: '+420722123457' },
      ], // getRecipientSegment
      [{ count: 1 }], // evaluateEventType for user-001
      [{ count: 1 }], // evaluateEventType for user-002
    ]);
    const bulkGate = makeBulkGate({ accepted: ['+420722123456', '+420722123457'], rejected: [] });

    const result = await executeCampaignSend(CAMPAIGN_ID, db, bulkGate);

    expect(result.sentCount).toBe(2);
    expect(result.failedCount).toBe(0);
  });

  it('rejects sending non-scheduled campaign', async () => {
    const db = makeDb([
      [makeCampaignRow({ status: 'pending' })],
    ]);
    const bulkGate = makeBulkGate();

    await expect(
      executeCampaignSend(CAMPAIGN_ID, db, bulkGate),
    ).rejects.toThrow('not scheduled');
  });

  it('rejects sending if scheduled time not reached', async () => {
    const futureTime = new Date(Date.now() + 3600000).toISOString();
    const db = makeDb([
      [makeCampaignRow({ status: 'scheduled', scheduled_at: futureTime })],
    ]);
    const bulkGate = makeBulkGate();

    await expect(
      executeCampaignSend(CAMPAIGN_ID, db, bulkGate),
    ).rejects.toThrow('not yet scheduled for send');
  });

  it('handles bulk rejection', async () => {
    const db = makeDb([
      [makeCampaignRow({ status: 'scheduled', scheduled_at: new Date(Date.now() - 1000).toISOString() })],
      [
        { id: USER_ID, phone: '+420722123456' },
        { id: 'user-002', phone: '+420722123457' },
      ],
      [{ count: 1 }], // evaluateEventType for user-001
      [{ count: 1 }], // evaluateEventType for user-002
    ]);
    const bulkGate = makeBulkGate({
      accepted: ['+420722123456'],
      rejected: [{ phone: '+420722123457', reason: 'Invalid' }],
    });

    const result = await executeCampaignSend(CAMPAIGN_ID, db, bulkGate);

    expect(result.sentCount).toBe(1);
    expect(result.failedCount).toBe(1);
  });
});

// =============================================================================
// Tests: Campaign retrieval and updates
// =============================================================================

describe('getCampaign', () => {
  it('retrieves campaign with stats', async () => {
    const db = makeDb([
      [makeCampaignRow()],
      [makeStatRow({ sent_count: 100 })],
    ]);

    const campaign = await getCampaign(CAMPAIGN_ID, db);

    expect(campaign.id).toBe(CAMPAIGN_ID);
    expect(campaign.stats.sentCount).toBe(100);
  });

  it('throws NOT_FOUND for missing campaign', async () => {
    const db = makeDb([[]]);

    await expect(getCampaign('missing', db)).rejects.toThrow('NOT_FOUND');
  });
});

describe('updateCampaign', () => {
  it('updates campaign name', async () => {
    const db = makeDb([
      [makeCampaignRow()],
      [makeCampaignRow({ name: 'Updated Name' })],
      [makeStatRow()],
    ]);

    const updated = await updateCampaign(CAMPAIGN_ID, { name: 'Updated Name' }, db);

    expect(updated.name).toBe('Updated Name');
  });

  it('rejects updating sent campaign', async () => {
    const db = makeDb([
      [makeCampaignRow({ status: 'sent' })],
    ]);

    await expect(
      updateCampaign(CAMPAIGN_ID, { name: 'New Name' }, db),
    ).rejects.toThrow('Cannot update a sent campaign');
  });

  it('validates body length on update', async () => {
    const db = makeDb([
      [makeCampaignRow()],
    ]);

    await expect(
      updateCampaign(CAMPAIGN_ID, { body: 'a'.repeat(161) }, db),
    ).rejects.toThrow('exceeds 160 characters');
  });
});

describe('deleteCampaign', () => {
  it('soft deletes campaign by archiving', async () => {
    const db = makeDb();

    await deleteCampaign(CAMPAIGN_ID, db);

    expect((db.execute as any).mock.calls[0][0]).toContain("status = $1");
  });
});

// =============================================================================
// Tests: Listing and pagination
// =============================================================================

describe('listCampaigns', () => {
  it('lists campaigns with pagination', async () => {
    const db = makeDb([
      [{ count: 5 }], // total count
      [makeCampaignRow(), makeCampaignRow({ id: 'camp-002' })],
      [makeStatRow()],
      [makeStatRow()],
    ]);

    const { campaigns, total } = await listCampaigns(PROMOTER_ID, db, 10, 0);

    expect(campaigns).toHaveLength(2);
    expect(total).toBe(5);
  });

  it('respects limit and offset', async () => {
    const db = makeDb([
      [{ count: 100 }],
      [makeCampaignRow()],
      [makeStatRow()],
    ]);

    const { campaigns } = await listCampaigns(PROMOTER_ID, db, 20, 40);

    expect(campaigns).toBeDefined();
  });

  it('excludes archived campaigns', async () => {
    const db = makeDb([
      [{ count: 3 }],
      [makeCampaignRow()],
      [makeStatRow()],
    ]);

    await listCampaigns(PROMOTER_ID, db);

    // Check that the query excludes archived status
    expect((db.query as any).mock.calls[0][0]).toContain("status != $2");
  });
});

// =============================================================================
// Tests: Recipient segmentation
// =============================================================================

describe('getRecipientSegment', () => {
  it('returns opted-in users matching all segment rules', async () => {
    const db = makeDb([
      [
        { id: USER_ID, phone: '+420722123456' },
        { id: 'user-002', phone: '+420722123457' },
      ],
    ]);

    const recipients = await getRecipientSegment(PROMOTER_ID, [], db);

    expect(recipients).toHaveLength(2);
    expect(recipients[0].phone).toBe('+420722123456');
  });
});

// =============================================================================
// Tests: Statistics updates
// =============================================================================

describe('updateCampaignStats', () => {
  it('updates sent and failed counts', async () => {
    const db = makeDb();

    await updateCampaignStats(CAMPAIGN_ID, 95, 5, db);

    expect((db.execute as any).mock.calls[0][0]).toContain('UPDATE');
    expect((db.execute as any).mock.calls[0][1]).toEqual([95, 5, CAMPAIGN_ID]);
  });
});
