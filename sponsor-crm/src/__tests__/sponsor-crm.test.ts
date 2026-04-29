import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createLead,
  advanceStage,
  assignLead,
  createProposal,
  sendProposal,
  acceptProposal,
  rejectProposal,
  bookAdSpace,
  getAdSpaceAvailability,
  getPipelineSummary,
  getLeadsForOrganizer,
} from '../services/sponsor-crm.service';
import type {
  DbAdapter,
  ServiceDeps,
  SponsorLead,
  SponsorProposal,
  AdSpace,
  AdSpaceBooking,
  ProposalLineItem,
} from '../types/sponsor-crm.types';
import { SponsorCrmError } from '../types/sponsor-crm.types';

// ── Helpers ──────────────────────────────────────────────────────────────────

const NOW = new Date('2026-04-15T10:00:00Z');
const START_OF_MONTH = new Date('2026-04-01T00:00:00Z');

function makeDeps(overrides: Partial<DbAdapter> = {}): ServiceDeps {
  const db: DbAdapter = {
    query: vi.fn(async () => []),
    execute: vi.fn(async () => undefined),
    transaction: vi.fn(async (fn) => fn(db)),
    ...overrides,
  };
  return { db, now: () => NOW };
}

function makeLead(overrides: Partial<SponsorLead> = {}): SponsorLead {
  return {
    id: 'lead-1',
    organizerId: 'org-1',
    companyName: 'Acme s.r.o.',
    contactName: 'Jan Novák',
    contactEmail: 'jan@acme.cz',
    contactPhone: '+420777123456',
    estimatedValueCzk: 100_000,
    stage: 'lead',
    assignedToUserId: null,
    source: 'referral',
    notes: null,
    nextActionAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeProposal(overrides: Partial<SponsorProposal> = {}): SponsorProposal {
  return {
    id: 'proposal-1',
    leadId: 'lead-1',
    organizerId: 'org-1',
    title: 'Sponzorský balíček',
    status: 'draft',
    lineItems: [],
    subtotalCzk: 50_000,
    discountCzk: 5_000,
    totalCzk: 45_000,
    validUntil: new Date('2026-05-01'),
    sentAt: null,
    respondedAt: null,
    createdAt: NOW,
    ...overrides,
  };
}

function makeAdSpace(overrides: Partial<AdSpace> = {}): AdSpace {
  return {
    id: 'space-1',
    organizerId: 'org-1',
    venueId: 'venue-1',
    name: 'LED Panel A',
    type: 'led_panel',
    description: 'Hlavní LED panel',
    priceCzk: 20_000,
    maxOccupancy: 2,
    currentOccupancy: 0,
    isAvailable: true,
    ...overrides,
  };
}

function makeLineItem(overrides: Partial<ProposalLineItem> = {}): ProposalLineItem {
  return {
    id: 'item-1',
    proposalId: 'proposal-1',
    adSpaceId: 'space-1',
    description: 'LED panel 1 měsíc',
    quantity: 1,
    unitPriceCzk: 20_000,
    totalCzk: 20_000,
    ...overrides,
  };
}

function makeBooking(overrides: Partial<AdSpaceBooking> = {}): AdSpaceBooking {
  return {
    id: 'booking-1',
    adSpaceId: 'space-1',
    leadId: 'lead-1',
    proposalId: null,
    eventId: null,
    startDate: new Date('2026-05-01'),
    endDate: new Date('2026-05-31'),
    pricePaidCzk: 20_000,
    notes: null,
    createdAt: NOW,
    ...overrides,
  };
}

// ── createLead ───────────────────────────────────────────────────────────────

describe('createLead', () => {
  it('inserts lead with stage=lead and returns the created lead', async () => {
    const lead = makeLead();
    const deps = makeDeps({
      query: vi.fn(async () => [lead]),
    });

    const result = await createLead(
      {
        organizerId: 'org-1',
        companyName: 'Acme s.r.o.',
        contactName: 'Jan Novák',
        contactEmail: 'jan@acme.cz',
        estimatedValueCzk: 100_000,
        source: 'referral',
      },
      deps,
    );

    expect(deps.db.execute).toHaveBeenCalledOnce();
    const execCall = (deps.db.execute as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(execCall[1]).toContain('lead'); // stage param
    expect(result.stage).toBe('lead');
    expect(result.companyName).toBe('Acme s.r.o.');
  });

  it('throws LEAD_NOT_FOUND if query returns empty after insert', async () => {
    const deps = makeDeps({
      query: vi.fn(async () => []),
    });

    await expect(
      createLead(
        { organizerId: 'org-1', companyName: 'X', contactName: 'Y', contactEmail: 'y@x.cz', estimatedValueCzk: 1000 },
        deps,
      ),
    ).rejects.toThrow(SponsorCrmError);
  });
});

// ── advanceStage ─────────────────────────────────────────────────────────────

describe('advanceStage', () => {
  it('transitions lead → qualified successfully', async () => {
    const lead = makeLead({ stage: 'lead' });
    const qualified = makeLead({ stage: 'qualified' });
    const query = vi.fn()
      .mockResolvedValueOnce([lead])
      .mockResolvedValueOnce([qualified]);
    const deps = makeDeps({ query });

    const result = await advanceStage('lead-1', 'qualified', deps);

    expect(deps.db.execute).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE'),
      expect.arrayContaining(['qualified']),
    );
    expect(result.stage).toBe('qualified');
  });

  it('transitions qualified → proposal_sent', async () => {
    const lead = makeLead({ stage: 'qualified' });
    const next = makeLead({ stage: 'proposal_sent' });
    const query = vi.fn()
      .mockResolvedValueOnce([lead])
      .mockResolvedValueOnce([next]);
    const deps = makeDeps({ query });

    const result = await advanceStage('lead-1', 'proposal_sent', deps);
    expect(result.stage).toBe('proposal_sent');
  });

  it('transitions negotiation → won', async () => {
    const lead = makeLead({ stage: 'negotiation' });
    const next = makeLead({ stage: 'won' });
    const query = vi.fn()
      .mockResolvedValueOnce([lead])
      .mockResolvedValueOnce([next]);
    const deps = makeDeps({ query });

    const result = await advanceStage('lead-1', 'won', deps);
    expect(result.stage).toBe('won');
  });

  it('transitions any stage → on_hold', async () => {
    const lead = makeLead({ stage: 'proposal_sent' });
    const next = makeLead({ stage: 'on_hold' });
    const query = vi.fn()
      .mockResolvedValueOnce([lead])
      .mockResolvedValueOnce([next]);
    const deps = makeDeps({ query });

    const result = await advanceStage('lead-1', 'on_hold', deps);
    expect(result.stage).toBe('on_hold');
  });

  it('transitions on_hold → previous stage', async () => {
    const lead = makeLead({ stage: 'on_hold' });
    const next = makeLead({ stage: 'negotiation' });
    const query = vi.fn()
      .mockResolvedValueOnce([lead])
      .mockResolvedValueOnce([next]);
    const deps = makeDeps({ query });

    const result = await advanceStage('lead-1', 'negotiation', deps);
    expect(result.stage).toBe('negotiation');
  });

  it('throws INVALID_STAGE_TRANSITION for invalid transition', async () => {
    const lead = makeLead({ stage: 'lead' });
    const query = vi.fn().mockResolvedValue([lead]);
    const deps = makeDeps({ query });

    await expect(advanceStage('lead-1', 'won', deps)).rejects.toThrow(SponsorCrmError);
    await expect(advanceStage('lead-1', 'won', deps)).rejects.toMatchObject({
      code: 'INVALID_STAGE_TRANSITION',
    });
  });

  it('throws INVALID_STAGE_TRANSITION when skipping stages (lead → negotiation)', async () => {
    const lead = makeLead({ stage: 'lead' });
    const query = vi.fn().mockResolvedValueOnce([lead]);
    const deps = makeDeps({ query });

    await expect(advanceStage('lead-1', 'negotiation', deps)).rejects.toThrow(SponsorCrmError);
  });

  it('throws LEAD_NOT_FOUND for missing lead', async () => {
    const deps = makeDeps({ query: vi.fn(async () => []) });

    await expect(advanceStage('missing', 'qualified', deps)).rejects.toMatchObject({
      code: 'LEAD_NOT_FOUND',
    });
  });
});

// ── createProposal ────────────────────────────────────────────────────────────

describe('createProposal', () => {
  it('calculates subtotal, discount and total correctly', async () => {
    const proposal = makeProposal({
      subtotalCzk: 60_000,
      discountCzk: 10_000,
      totalCzk: 50_000,
      lineItems: [makeLineItem({ quantity: 2, unitPriceCzk: 30_000, totalCzk: 60_000 })],
    });

    const db: DbAdapter = {
      query: vi.fn(async () => [proposal]),
      execute: vi.fn(async () => undefined),
      transaction: vi.fn(async (fn) => fn(db)),
    };
    const deps: ServiceDeps = { db, now: () => NOW };

    const result = await createProposal(
      {
        leadId: 'lead-1',
        organizerId: 'org-1',
        title: 'Sponzorský balíček',
        lineItems: [{ description: 'LED panel', quantity: 2, unitPriceCzk: 30_000 }],
        discountCzk: 10_000,
        validUntil: new Date('2026-05-01'),
      },
      deps,
    );

    expect(result.subtotalCzk).toBe(60_000);
    expect(result.discountCzk).toBe(10_000);
    expect(result.totalCzk).toBe(50_000);
  });

  it('inserts correct number of lineItems', async () => {
    const proposal = makeProposal({
      lineItems: [
        makeLineItem({ id: 'i1', description: 'Item 1' }),
        makeLineItem({ id: 'i2', description: 'Item 2' }),
        makeLineItem({ id: 'i3', description: 'Item 3' }),
      ],
    });

    const db: DbAdapter = {
      query: vi.fn(async () => [proposal]),
      execute: vi.fn(async () => undefined),
      transaction: vi.fn(async (fn) => fn(db)),
    };
    const deps: ServiceDeps = { db, now: () => NOW };

    const result = await createProposal(
      {
        leadId: 'lead-1',
        organizerId: 'org-1',
        title: 'Test',
        lineItems: [
          { description: 'Item 1', quantity: 1, unitPriceCzk: 10_000 },
          { description: 'Item 2', quantity: 1, unitPriceCzk: 10_000 },
          { description: 'Item 3', quantity: 1, unitPriceCzk: 10_000 },
        ],
        validUntil: new Date('2026-05-01'),
      },
      deps,
    );

    // 3 line item inserts + 1 proposal insert = 4 execute calls
    const executeCalls = (db.execute as ReturnType<typeof vi.fn>).mock.calls;
    const lineItemInserts = executeCalls.filter((c) =>
      (c[0] as string).includes('proposal_line_items'),
    );
    expect(lineItemInserts).toHaveLength(3);
    expect(result.lineItems).toHaveLength(3);
  });

  it('uses zero discount when discountCzk not provided', async () => {
    const proposal = makeProposal({
      subtotalCzk: 20_000,
      discountCzk: 0,
      totalCzk: 20_000,
      lineItems: [],
    });

    const db: DbAdapter = {
      query: vi.fn(async () => [proposal]),
      execute: vi.fn(async () => undefined),
      transaction: vi.fn(async (fn) => fn(db)),
    };
    const deps: ServiceDeps = { db, now: () => NOW };

    const result = await createProposal(
      {
        leadId: 'lead-1',
        organizerId: 'org-1',
        title: 'No discount',
        lineItems: [{ description: 'Item', quantity: 1, unitPriceCzk: 20_000 }],
        validUntil: new Date('2026-05-01'),
      },
      deps,
    );

    expect(result.discountCzk).toBe(0);
    expect(result.totalCzk).toBe(20_000);
  });
});

// ── sendProposal ──────────────────────────────────────────────────────────────

describe('sendProposal', () => {
  it('sets status=sent and sentAt=now', async () => {
    const proposal = makeProposal({ status: 'draft' });
    const sentProposal = makeProposal({ status: 'sent', sentAt: NOW });
    const lead = makeLead({ stage: 'qualified' });

    const query = vi.fn()
      .mockResolvedValueOnce([proposal])      // fetch proposal
      .mockResolvedValueOnce([lead])           // fetch lead
      .mockResolvedValueOnce([sentProposal])   // fetch updated proposal
      .mockResolvedValueOnce([]);              // fetch line items

    const deps = makeDeps({ query });

    const result = await sendProposal('proposal-1', deps);

    expect(result.status).toBe('sent');
    expect(result.sentAt).toEqual(NOW);
  });

  it('throws PROPOSAL_NOT_FOUND for missing proposal', async () => {
    const deps = makeDeps({ query: vi.fn(async () => []) });

    await expect(sendProposal('missing', deps)).rejects.toMatchObject({
      code: 'PROPOSAL_NOT_FOUND',
    });
  });
});

// ── acceptProposal ────────────────────────────────────────────────────────────

describe('acceptProposal', () => {
  it('sets status=accepted and respondedAt=now', async () => {
    const proposal = makeProposal({ status: 'sent' });
    const acceptedProposal = makeProposal({ status: 'accepted', respondedAt: NOW });
    const lead = makeLead({ stage: 'proposal_sent' });

    const query = vi.fn()
      .mockResolvedValueOnce([proposal])
      .mockResolvedValueOnce([lead])
      .mockResolvedValueOnce([acceptedProposal])
      .mockResolvedValueOnce([]);

    const deps = makeDeps({ query });

    const result = await acceptProposal('proposal-1', deps);

    expect(result.status).toBe('accepted');
    expect(result.respondedAt).toEqual(NOW);
  });

  it('advances lead stage to negotiation when in proposal_sent', async () => {
    const proposal = makeProposal({ status: 'sent' });
    const acceptedProposal = makeProposal({ status: 'accepted', respondedAt: NOW });
    const lead = makeLead({ stage: 'proposal_sent' });

    const query = vi.fn()
      .mockResolvedValueOnce([proposal])
      .mockResolvedValueOnce([lead])
      .mockResolvedValueOnce([acceptedProposal])
      .mockResolvedValueOnce([]);

    const deps = makeDeps({ query });

    await acceptProposal('proposal-1', deps);

    expect(deps.db.execute).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE'),
      expect.arrayContaining(['negotiation']),
    );
  });

  it('throws PROPOSAL_NOT_FOUND for missing proposal', async () => {
    const deps = makeDeps({ query: vi.fn(async () => []) });

    await expect(acceptProposal('missing', deps)).rejects.toMatchObject({
      code: 'PROPOSAL_NOT_FOUND',
    });
  });
});

// ── rejectProposal ────────────────────────────────────────────────────────────

describe('rejectProposal', () => {
  it('sets status=rejected and respondedAt=now', async () => {
    const proposal = makeProposal({ status: 'sent' });
    const rejectedProposal = makeProposal({ status: 'rejected', respondedAt: NOW });

    const query = vi.fn()
      .mockResolvedValueOnce([proposal])
      .mockResolvedValueOnce([rejectedProposal])
      .mockResolvedValueOnce([]);

    const deps = makeDeps({ query });

    const result = await rejectProposal('proposal-1', deps);

    expect(result.status).toBe('rejected');
    expect(result.respondedAt).toEqual(NOW);
  });

  it('throws PROPOSAL_NOT_FOUND for missing proposal', async () => {
    const deps = makeDeps({ query: vi.fn(async () => []) });

    await expect(rejectProposal('missing', deps)).rejects.toMatchObject({
      code: 'PROPOSAL_NOT_FOUND',
    });
  });
});

// ── bookAdSpace ───────────────────────────────────────────────────────────────

describe('bookAdSpace', () => {
  it('creates booking successfully for available ad space', async () => {
    const adSpace = makeAdSpace({ currentOccupancy: 0, maxOccupancy: 2, isAvailable: true });
    const booking = makeBooking();

    const db: DbAdapter = {
      query: vi.fn()
        .mockResolvedValueOnce([adSpace])  // fetch ad space
        .mockResolvedValueOnce([booking]), // fetch booking after insert
      execute: vi.fn(async () => undefined),
      transaction: vi.fn(async (fn) => fn(db)),
    };
    const deps: ServiceDeps = { db, now: () => NOW };

    const result = await bookAdSpace(
      'space-1',
      'lead-1',
      { startDate: new Date('2026-05-01'), endDate: new Date('2026-05-31'), pricePaidCzk: 20_000 },
      deps,
    );

    expect(result.adSpaceId).toBe('space-1');
    expect(result.leadId).toBe('lead-1');
  });

  it('increments currentOccupancy after booking', async () => {
    const adSpace = makeAdSpace({ currentOccupancy: 0, maxOccupancy: 2, isAvailable: true });
    const booking = makeBooking();

    const db: DbAdapter = {
      query: vi.fn()
        .mockResolvedValueOnce([adSpace])
        .mockResolvedValueOnce([booking]),
      execute: vi.fn(async () => undefined),
      transaction: vi.fn(async (fn) => fn(db)),
    };
    const deps: ServiceDeps = { db, now: () => NOW };

    await bookAdSpace(
      'space-1',
      'lead-1',
      { startDate: new Date('2026-05-01'), endDate: new Date('2026-05-31'), pricePaidCzk: 20_000 },
      deps,
    );

    const updateCall = (db.execute as ReturnType<typeof vi.fn>).mock.calls.find((c) =>
      (c[0] as string).includes('UPDATE ad_spaces'),
    );
    expect(updateCall).toBeDefined();
    expect(updateCall![1]).toContain(1); // newOccupancy = 1
  });

  it('sets isAvailable=false when reaching maxOccupancy', async () => {
    const adSpace = makeAdSpace({ currentOccupancy: 1, maxOccupancy: 2, isAvailable: true });
    const booking = makeBooking();

    const db: DbAdapter = {
      query: vi.fn()
        .mockResolvedValueOnce([adSpace])
        .mockResolvedValueOnce([booking]),
      execute: vi.fn(async () => undefined),
      transaction: vi.fn(async (fn) => fn(db)),
    };
    const deps: ServiceDeps = { db, now: () => NOW };

    await bookAdSpace(
      'space-1',
      'lead-1',
      { startDate: new Date('2026-05-01'), endDate: new Date('2026-05-31'), pricePaidCzk: 20_000 },
      deps,
    );

    const updateCall = (db.execute as ReturnType<typeof vi.fn>).mock.calls.find((c) =>
      (c[0] as string).includes('UPDATE ad_spaces'),
    );
    // newOccupancy=2 equals maxOccupancy=2, so isAvailable=false
    expect(updateCall![1]).toContain(false);
  });

  it('throws AD_SPACE_UNAVAILABLE when space is full', async () => {
    const adSpace = makeAdSpace({ currentOccupancy: 2, maxOccupancy: 2, isAvailable: false });

    const deps = makeDeps({
      query: vi.fn(async () => [adSpace]),
    });

    await expect(
      bookAdSpace(
        'space-1',
        'lead-1',
        { startDate: new Date('2026-05-01'), endDate: new Date('2026-05-31'), pricePaidCzk: 20_000 },
        deps,
      ),
    ).rejects.toMatchObject({ code: 'AD_SPACE_UNAVAILABLE' });
  });

  it('throws AD_SPACE_NOT_FOUND for missing ad space', async () => {
    const deps = makeDeps({ query: vi.fn(async () => []) });

    await expect(
      bookAdSpace(
        'missing',
        'lead-1',
        { startDate: new Date('2026-05-01'), endDate: new Date('2026-05-31'), pricePaidCzk: 20_000 },
        deps,
      ),
    ).rejects.toMatchObject({ code: 'AD_SPACE_NOT_FOUND' });
  });
});

// ── getAdSpaceAvailability ────────────────────────────────────────────────────

describe('getAdSpaceAvailability', () => {
  it('returns all ad spaces for organizer', async () => {
    const spaces = [
      makeAdSpace({ id: 'space-1', isAvailable: true }),
      makeAdSpace({ id: 'space-2', isAvailable: false }),
    ];
    const deps = makeDeps({ query: vi.fn(async () => spaces) });

    const result = await getAdSpaceAvailability('org-1', deps);

    expect(result).toHaveLength(2);
    expect(result[0]?.isAvailable).toBe(true);
    expect(result[1]?.isAvailable).toBe(false);
  });

  it('returns empty array when no ad spaces exist', async () => {
    const deps = makeDeps({ query: vi.fn(async () => []) });

    const result = await getAdSpaceAvailability('org-1', deps);

    expect(result).toHaveLength(0);
  });
});

// ── getPipelineSummary ────────────────────────────────────────────────────────

describe('getPipelineSummary', () => {
  it('returns correct byStage counts', async () => {
    const leads: SponsorLead[] = [
      makeLead({ id: 'l1', stage: 'lead', estimatedValueCzk: 50_000 }),
      makeLead({ id: 'l2', stage: 'lead', estimatedValueCzk: 30_000 }),
      makeLead({ id: 'l3', stage: 'qualified', estimatedValueCzk: 100_000 }),
      makeLead({ id: 'l4', stage: 'won', estimatedValueCzk: 200_000, updatedAt: NOW }),
      makeLead({ id: 'l5', stage: 'lost', estimatedValueCzk: 80_000 }),
    ];

    const deps = makeDeps({ query: vi.fn(async () => leads) });

    const result = await getPipelineSummary('org-1', deps);

    expect(result.byStage['lead']?.count).toBe(2);
    expect(result.byStage['lead']?.valueCzk).toBe(80_000);
    expect(result.byStage['qualified']?.count).toBe(1);
    expect(result.byStage['won']?.count).toBe(1);
    expect(result.byStage['lost']?.count).toBe(1);
  });

  it('calculates conversionRate as won / (won + lost)', async () => {
    const leads: SponsorLead[] = [
      makeLead({ id: 'l1', stage: 'won', estimatedValueCzk: 100_000, updatedAt: NOW }),
      makeLead({ id: 'l2', stage: 'won', estimatedValueCzk: 100_000, updatedAt: NOW }),
      makeLead({ id: 'l3', stage: 'lost', estimatedValueCzk: 50_000 }),
      makeLead({ id: 'l4', stage: 'lead', estimatedValueCzk: 50_000 }),
    ];

    const deps = makeDeps({ query: vi.fn(async () => leads) });

    const result = await getPipelineSummary('org-1', deps);

    expect(result.conversionRate).toBeCloseTo(2 / 3);
  });

  it('returns conversionRate=0 when no won or lost leads', async () => {
    const leads: SponsorLead[] = [
      makeLead({ id: 'l1', stage: 'lead', estimatedValueCzk: 50_000 }),
    ];

    const deps = makeDeps({ query: vi.fn(async () => leads) });

    const result = await getPipelineSummary('org-1', deps);

    expect(result.conversionRate).toBe(0);
  });

  it('calculates wonThisMonthCzk correctly', async () => {
    const lastMonth = new Date('2026-03-15T10:00:00Z');
    const leads: SponsorLead[] = [
      makeLead({ id: 'l1', stage: 'won', estimatedValueCzk: 200_000, updatedAt: NOW }),
      makeLead({ id: 'l2', stage: 'won', estimatedValueCzk: 150_000, updatedAt: lastMonth }),
    ];

    const deps = makeDeps({ query: vi.fn(async () => leads) });

    const result = await getPipelineSummary('org-1', deps);

    expect(result.wonThisMonthCzk).toBe(200_000);
  });

  it('returns totalLeads and totalEstimatedValueCzk', async () => {
    const leads: SponsorLead[] = [
      makeLead({ id: 'l1', estimatedValueCzk: 100_000 }),
      makeLead({ id: 'l2', estimatedValueCzk: 200_000 }),
    ];

    const deps = makeDeps({ query: vi.fn(async () => leads) });

    const result = await getPipelineSummary('org-1', deps);

    expect(result.totalLeads).toBe(2);
    expect(result.totalEstimatedValueCzk).toBe(300_000);
  });
});

// ── getLeadsForOrganizer ──────────────────────────────────────────────────────

describe('getLeadsForOrganizer', () => {
  it('returns all leads when no stage filter provided', async () => {
    const leads = [
      makeLead({ id: 'l1', stage: 'lead' }),
      makeLead({ id: 'l2', stage: 'qualified' }),
      makeLead({ id: 'l3', stage: 'won' }),
    ];

    const query = vi.fn(async () => leads);
    const deps = makeDeps({ query });

    const result = await getLeadsForOrganizer('org-1', undefined, deps);

    expect(result).toHaveLength(3);
    // Should query without stage filter
    const queryCall = query.mock.calls[0];
    expect(queryCall![0]).not.toContain('AND stage');
  });

  it('filters by stage when stage provided', async () => {
    const leads = [makeLead({ id: 'l1', stage: 'qualified' })];

    const query = vi.fn(async () => leads);
    const deps = makeDeps({ query });

    const result = await getLeadsForOrganizer('org-1', 'qualified', deps);

    expect(result).toHaveLength(1);
    // Should query with stage filter
    const queryCall = query.mock.calls[0];
    expect(queryCall![0]).toContain('AND stage');
    expect(queryCall![1]).toContain('qualified');
  });

  it('returns empty array when no leads match', async () => {
    const deps = makeDeps({ query: vi.fn(async () => []) });

    const result = await getLeadsForOrganizer('org-1', 'won', deps);

    expect(result).toHaveLength(0);
  });
});
