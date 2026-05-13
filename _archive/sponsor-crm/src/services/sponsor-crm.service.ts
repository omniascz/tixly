import {
  DealStage,
  LeadInput,
  ProposalInput,
  ServiceDeps,
  SponsorCrmError,
  SponsorLead,
  SponsorProposal,
  AdSpace,
  AdSpaceBooking,
  PipelineSummary,
  ProposalLineItem,
} from '../types/sponsor-crm.types';

// Valid stage transitions
// on_hold is special: any stage → on_hold, on_hold → any stage (except itself)
const FORWARD_TRANSITIONS: Record<DealStage, DealStage[]> = {
  lead: ['qualified', 'on_hold'],
  qualified: ['proposal_sent', 'on_hold'],
  proposal_sent: ['negotiation', 'on_hold'],
  negotiation: ['won', 'lost', 'on_hold'],
  won: ['on_hold'],
  lost: ['on_hold'],
  on_hold: ['lead', 'qualified', 'proposal_sent', 'negotiation', 'won', 'lost'],
};

function isValidTransition(current: DealStage, next: DealStage): boolean {
  const allowed = FORWARD_TRANSITIONS[current];
  return allowed !== undefined && allowed.includes(next);
}

function generateId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export async function createLead(
  input: LeadInput,
  deps: ServiceDeps,
): Promise<SponsorLead> {
  const now = deps.now ? deps.now() : new Date();
  const id = generateId();

  await deps.db.execute(
    `INSERT INTO sponsor_leads (id, organizer_id, company_name, contact_name, contact_email,
      contact_phone, estimated_value_czk, stage, assigned_to_user_id, source, notes,
      next_action_at, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [
      id,
      input.organizerId,
      input.companyName,
      input.contactName,
      input.contactEmail,
      input.contactPhone ?? null,
      input.estimatedValueCzk,
      'lead',
      input.assignedToUserId ?? null,
      input.source ?? null,
      null,
      null,
      now,
      now,
    ],
  );

  const rows = await deps.db.query<SponsorLead>(
    'SELECT * FROM sponsor_leads WHERE id = $1',
    [id],
  );

  const lead = rows[0];
  if (!lead) throw new SponsorCrmError('LEAD_NOT_FOUND', `Lead ${id} not found after insert`);
  return lead;
}

export async function advanceStage(
  leadId: string,
  newStage: DealStage,
  deps: ServiceDeps,
): Promise<SponsorLead> {
  const now = deps.now ? deps.now() : new Date();

  const rows = await deps.db.query<SponsorLead>(
    'SELECT * FROM sponsor_leads WHERE id = $1',
    [leadId],
  );
  const lead = rows[0];
  if (!lead) throw new SponsorCrmError('LEAD_NOT_FOUND', `Lead ${leadId} not found`);

  if (!isValidTransition(lead.stage, newStage)) {
    throw new SponsorCrmError(
      'INVALID_STAGE_TRANSITION',
      `Cannot transition from '${lead.stage}' to '${newStage}'`,
    );
  }

  await deps.db.execute(
    'UPDATE sponsor_leads SET stage = $1, updated_at = $2 WHERE id = $3',
    [newStage, now, leadId],
  );

  const updated = await deps.db.query<SponsorLead>(
    'SELECT * FROM sponsor_leads WHERE id = $1',
    [leadId],
  );
  const updatedLead = updated[0];
  if (!updatedLead) throw new SponsorCrmError('LEAD_NOT_FOUND', `Lead ${leadId} not found after update`);
  return updatedLead;
}

export async function assignLead(
  leadId: string,
  userId: string,
  deps: ServiceDeps,
): Promise<SponsorLead> {
  const now = deps.now ? deps.now() : new Date();

  const rows = await deps.db.query<SponsorLead>(
    'SELECT * FROM sponsor_leads WHERE id = $1',
    [leadId],
  );
  if (!rows[0]) throw new SponsorCrmError('LEAD_NOT_FOUND', `Lead ${leadId} not found`);

  await deps.db.execute(
    'UPDATE sponsor_leads SET assigned_to_user_id = $1, updated_at = $2 WHERE id = $3',
    [userId, now, leadId],
  );

  const updated = await deps.db.query<SponsorLead>(
    'SELECT * FROM sponsor_leads WHERE id = $1',
    [leadId],
  );
  const updatedLead = updated[0];
  if (!updatedLead) throw new SponsorCrmError('LEAD_NOT_FOUND', `Lead ${leadId} not found after update`);
  return updatedLead;
}

export async function createProposal(
  input: ProposalInput,
  deps: ServiceDeps,
): Promise<SponsorProposal> {
  const now = deps.now ? deps.now() : new Date();
  const proposalId = generateId();

  const subtotalCzk = input.lineItems.reduce(
    (sum, item) => sum + item.quantity * item.unitPriceCzk,
    0,
  );
  const discountCzk = input.discountCzk ?? 0;
  const totalCzk = subtotalCzk - discountCzk;

  const proposal = await deps.db.transaction(async (db) => {
    await db.execute(
      `INSERT INTO sponsor_proposals (id, lead_id, organizer_id, title, status,
        subtotal_czk, discount_czk, total_czk, valid_until, sent_at, responded_at, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        proposalId,
        input.leadId,
        input.organizerId,
        input.title,
        'draft',
        subtotalCzk,
        discountCzk,
        totalCzk,
        input.validUntil,
        null,
        null,
        now,
      ],
    );

    const lineItems: ProposalLineItem[] = [];
    for (const item of input.lineItems) {
      const itemId = generateId();
      const itemTotal = item.quantity * item.unitPriceCzk;
      await db.execute(
        `INSERT INTO proposal_line_items (id, proposal_id, ad_space_id, description, quantity, unit_price_czk, total_czk)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          itemId,
          proposalId,
          item.adSpaceId ?? null,
          item.description,
          item.quantity,
          item.unitPriceCzk,
          itemTotal,
        ],
      );
      lineItems.push({
        id: itemId,
        proposalId,
        adSpaceId: item.adSpaceId ?? null,
        description: item.description,
        quantity: item.quantity,
        unitPriceCzk: item.unitPriceCzk,
        totalCzk: itemTotal,
      });
    }

    const rows = await db.query<SponsorProposal>(
      'SELECT * FROM sponsor_proposals WHERE id = $1',
      [proposalId],
    );
    const p = rows[0];
    if (!p) throw new SponsorCrmError('PROPOSAL_NOT_FOUND', `Proposal ${proposalId} not found after insert`);
    return { ...p, lineItems };
  });

  return proposal;
}

export async function sendProposal(
  proposalId: string,
  deps: ServiceDeps,
): Promise<SponsorProposal> {
  const now = deps.now ? deps.now() : new Date();

  const rows = await deps.db.query<SponsorProposal>(
    'SELECT * FROM sponsor_proposals WHERE id = $1',
    [proposalId],
  );
  const proposal = rows[0];
  if (!proposal) throw new SponsorCrmError('PROPOSAL_NOT_FOUND', `Proposal ${proposalId} not found`);

  await deps.db.execute(
    'UPDATE sponsor_proposals SET status = $1, sent_at = $2 WHERE id = $3',
    ['sent', now, proposalId],
  );

  // Advance lead stage to proposal_sent if it hasn't reached that stage yet
  const stageOrder: DealStage[] = ['lead', 'qualified', 'proposal_sent', 'negotiation', 'won', 'lost', 'on_hold'];
  const leadRows = await deps.db.query<SponsorLead>(
    'SELECT * FROM sponsor_leads WHERE id = $1',
    [proposal.leadId],
  );
  const lead = leadRows[0];
  if (lead) {
    const leadStageIndex = stageOrder.indexOf(lead.stage);
    const proposalSentIndex = stageOrder.indexOf('proposal_sent');
    if (leadStageIndex < proposalSentIndex && lead.stage !== 'on_hold') {
      // Advance stage step by step to 'proposal_sent'
      if (isValidTransition(lead.stage, 'proposal_sent')) {
        await deps.db.execute(
          'UPDATE sponsor_leads SET stage = $1, updated_at = $2 WHERE id = $3',
          ['proposal_sent', now, lead.id],
        );
      } else if (lead.stage === 'lead') {
        await deps.db.execute(
          'UPDATE sponsor_leads SET stage = $1, updated_at = $2 WHERE id = $3',
          ['qualified', now, lead.id],
        );
        await deps.db.execute(
          'UPDATE sponsor_leads SET stage = $1, updated_at = $2 WHERE id = $3',
          ['proposal_sent', now, lead.id],
        );
      }
    }
  }

  const updated = await deps.db.query<SponsorProposal>(
    'SELECT * FROM sponsor_proposals WHERE id = $1',
    [proposalId],
  );
  const updatedProposal = updated[0];
  if (!updatedProposal) throw new SponsorCrmError('PROPOSAL_NOT_FOUND', `Proposal ${proposalId} not found after update`);

  const lineItemRows = await deps.db.query<ProposalLineItem>(
    'SELECT * FROM proposal_line_items WHERE proposal_id = $1',
    [proposalId],
  );
  return { ...updatedProposal, lineItems: lineItemRows };
}

export async function acceptProposal(
  proposalId: string,
  deps: ServiceDeps,
): Promise<SponsorProposal> {
  const now = deps.now ? deps.now() : new Date();

  const rows = await deps.db.query<SponsorProposal>(
    'SELECT * FROM sponsor_proposals WHERE id = $1',
    [proposalId],
  );
  const proposal = rows[0];
  if (!proposal) throw new SponsorCrmError('PROPOSAL_NOT_FOUND', `Proposal ${proposalId} not found`);

  await deps.db.execute(
    'UPDATE sponsor_proposals SET status = $1, responded_at = $2 WHERE id = $3',
    ['accepted', now, proposalId],
  );

  // Advance lead to negotiation or won
  const leadRows = await deps.db.query<SponsorLead>(
    'SELECT * FROM sponsor_leads WHERE id = $1',
    [proposal.leadId],
  );
  const lead = leadRows[0];
  if (lead && isValidTransition(lead.stage, 'negotiation')) {
    await deps.db.execute(
      'UPDATE sponsor_leads SET stage = $1, updated_at = $2 WHERE id = $3',
      ['negotiation', now, lead.id],
    );
  } else if (lead && isValidTransition(lead.stage, 'won')) {
    await deps.db.execute(
      'UPDATE sponsor_leads SET stage = $1, updated_at = $2 WHERE id = $3',
      ['won', now, lead.id],
    );
  }

  const updated = await deps.db.query<SponsorProposal>(
    'SELECT * FROM sponsor_proposals WHERE id = $1',
    [proposalId],
  );
  const updatedProposal = updated[0];
  if (!updatedProposal) throw new SponsorCrmError('PROPOSAL_NOT_FOUND', `Proposal ${proposalId} not found after update`);

  const lineItemRows = await deps.db.query<ProposalLineItem>(
    'SELECT * FROM proposal_line_items WHERE proposal_id = $1',
    [proposalId],
  );
  return { ...updatedProposal, lineItems: lineItemRows };
}

export async function rejectProposal(
  proposalId: string,
  deps: ServiceDeps,
): Promise<SponsorProposal> {
  const now = deps.now ? deps.now() : new Date();

  const rows = await deps.db.query<SponsorProposal>(
    'SELECT * FROM sponsor_proposals WHERE id = $1',
    [proposalId],
  );
  const proposal = rows[0];
  if (!proposal) throw new SponsorCrmError('PROPOSAL_NOT_FOUND', `Proposal ${proposalId} not found`);

  await deps.db.execute(
    'UPDATE sponsor_proposals SET status = $1, responded_at = $2 WHERE id = $3',
    ['rejected', now, proposalId],
  );

  const updated = await deps.db.query<SponsorProposal>(
    'SELECT * FROM sponsor_proposals WHERE id = $1',
    [proposalId],
  );
  const updatedProposal = updated[0];
  if (!updatedProposal) throw new SponsorCrmError('PROPOSAL_NOT_FOUND', `Proposal ${proposalId} not found after update`);

  const lineItemRows = await deps.db.query<ProposalLineItem>(
    'SELECT * FROM proposal_line_items WHERE proposal_id = $1',
    [proposalId],
  );
  return { ...updatedProposal, lineItems: lineItemRows };
}

export async function bookAdSpace(
  adSpaceId: string,
  leadId: string,
  params: { startDate: Date; endDate: Date; pricePaidCzk: number; proposalId?: string; eventId?: string },
  deps: ServiceDeps,
): Promise<AdSpaceBooking> {
  const now = deps.now ? deps.now() : new Date();

  const adSpaceRows = await deps.db.query<AdSpace>(
    'SELECT * FROM ad_spaces WHERE id = $1',
    [adSpaceId],
  );
  const adSpace = adSpaceRows[0];
  if (!adSpace) throw new SponsorCrmError('AD_SPACE_NOT_FOUND', `AdSpace ${adSpaceId} not found`);
  if (!adSpace.isAvailable || adSpace.currentOccupancy >= adSpace.maxOccupancy) {
    throw new SponsorCrmError('AD_SPACE_UNAVAILABLE', `AdSpace ${adSpaceId} is not available`);
  }

  const booking = await deps.db.transaction(async (db) => {
    const bookingId = generateId();

    await db.execute(
      `INSERT INTO ad_space_bookings (id, ad_space_id, lead_id, proposal_id, event_id,
        start_date, end_date, price_paid_czk, notes, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        bookingId,
        adSpaceId,
        leadId,
        params.proposalId ?? null,
        params.eventId ?? null,
        params.startDate,
        params.endDate,
        params.pricePaidCzk,
        null,
        now,
      ],
    );

    const newOccupancy = adSpace.currentOccupancy + 1;
    const newAvailable = newOccupancy < adSpace.maxOccupancy;

    await db.execute(
      'UPDATE ad_spaces SET current_occupancy = $1, is_available = $2 WHERE id = $3',
      [newOccupancy, newAvailable, adSpaceId],
    );

    const rows = await db.query<AdSpaceBooking>(
      'SELECT * FROM ad_space_bookings WHERE id = $1',
      [bookingId],
    );
    const b = rows[0];
    if (!b) throw new SponsorCrmError('AD_SPACE_NOT_FOUND', `Booking ${bookingId} not found after insert`);
    return b;
  });

  return booking;
}

export async function getAdSpaceAvailability(
  organizerId: string,
  deps: ServiceDeps,
): Promise<AdSpace[]> {
  const rows = await deps.db.query<AdSpace>(
    'SELECT * FROM ad_spaces WHERE organizer_id = $1',
    [organizerId],
  );
  return rows;
}

export async function getPipelineSummary(
  organizerId: string,
  deps: ServiceDeps,
): Promise<PipelineSummary> {
  const now = deps.now ? deps.now() : new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const leads = await deps.db.query<SponsorLead>(
    'SELECT * FROM sponsor_leads WHERE organizer_id = $1',
    [organizerId],
  );

  const allStages: DealStage[] = ['lead', 'qualified', 'proposal_sent', 'negotiation', 'won', 'lost', 'on_hold'];
  const byStage = Object.fromEntries(
    allStages.map((s) => [s, { count: 0, valueCzk: 0 }]),
  ) as Record<DealStage, { count: number; valueCzk: number }>;

  let wonCount = 0;
  let lostCount = 0;
  let wonThisMonthCzk = 0;

  for (const lead of leads) {
    const stageData = byStage[lead.stage];
    if (stageData) {
      stageData.count += 1;
      stageData.valueCzk += lead.estimatedValueCzk;
    }
    if (lead.stage === 'won') {
      wonCount += 1;
      if (lead.updatedAt >= startOfMonth) {
        wonThisMonthCzk += lead.estimatedValueCzk;
      }
    }
    if (lead.stage === 'lost') {
      lostCount += 1;
    }
  }

  const totalEstimatedValueCzk = leads.reduce((sum, l) => sum + l.estimatedValueCzk, 0);
  const conversionRate = wonCount + lostCount > 0 ? wonCount / (wonCount + lostCount) : 0;

  return {
    organizerId,
    totalLeads: leads.length,
    totalEstimatedValueCzk,
    byStage,
    wonThisMonthCzk,
    conversionRate,
  };
}

export async function getLeadsForOrganizer(
  organizerId: string,
  stage: DealStage | undefined,
  deps: ServiceDeps,
): Promise<SponsorLead[]> {
  if (stage !== undefined) {
    return deps.db.query<SponsorLead>(
      'SELECT * FROM sponsor_leads WHERE organizer_id = $1 AND stage = $2',
      [organizerId, stage],
    );
  }
  return deps.db.query<SponsorLead>(
    'SELECT * FROM sponsor_leads WHERE organizer_id = $1',
    [organizerId],
  );
}
