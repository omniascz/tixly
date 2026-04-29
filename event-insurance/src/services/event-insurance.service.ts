import { randomUUID } from 'crypto';
import type {
  DbAdapter,
  EventInsurancePolicy,
  InsuranceClaim,
  InsuranceQuote,
  InsuranceEventType,
  InsuranceProviderFn,
} from '../lib/types.js';

// ─── Internal DB row shapes ──────────────────────────────────────────────────

interface PolicyRow {
  id: string;
  promoter_id: string;
  event_id: string;
  provider: string;
  policy_number: string | null;
  covered_events: InsuranceEventType[] | string;
  coverage_amount_halire: number;
  premium_halire: number;
  status: string;
  coverage_from: string;
  coverage_to: string;
  created_at: string;
}

interface ClaimRow {
  id: string;
  policy_id: string;
  promoter_id: string;
  event_id: string;
  claim_type: string;
  description: string;
  requested_amount_halire: number;
  approved_amount_halire: number | null;
  status: string;
  submitted_at: string;
  resolved_at: string | null;
}

interface OrderRow {
  id: string;
  total_halire: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function rowToPolicy(row: PolicyRow): EventInsurancePolicy {
  const coveredEvents: InsuranceEventType[] =
    typeof row.covered_events === 'string'
      ? (JSON.parse(row.covered_events) as InsuranceEventType[])
      : row.covered_events;
  return {
    id: row.id,
    promoterId: row.promoter_id,
    eventId: row.event_id,
    provider: row.provider,
    policyNumber: row.policy_number ?? undefined,
    coveredEvents,
    coverageAmountHalire: row.coverage_amount_halire,
    premiumHalire: row.premium_halire,
    status: row.status as EventInsurancePolicy['status'],
    coverageFrom: typeof row.coverage_from === 'string' ? row.coverage_from : new Date(row.coverage_from).toISOString(),
    coverageTo: typeof row.coverage_to === 'string' ? row.coverage_to : new Date(row.coverage_to).toISOString(),
    createdAt: typeof row.created_at === 'string' ? row.created_at : new Date(row.created_at).toISOString(),
  };
}

function rowToClaim(row: ClaimRow): InsuranceClaim {
  return {
    id: row.id,
    policyId: row.policy_id,
    promoterId: row.promoter_id,
    eventId: row.event_id,
    claimType: row.claim_type as InsuranceEventType,
    description: row.description,
    requestedAmountHalire: row.requested_amount_halire,
    approvedAmountHalire: row.approved_amount_halire ?? undefined,
    status: row.status as InsuranceClaim['status'],
    submittedAt: typeof row.submitted_at === 'string' ? row.submitted_at : new Date(row.submitted_at).toISOString(),
    resolvedAt: row.resolved_at ?? undefined,
  };
}

// ─── Service functions ────────────────────────────────────────────────────────

/**
 * Získá nabídky pojištění od providera.
 */
export async function getInsuranceQuote(
  eventId: string,
  promoterId: string,
  coveredEvents: InsuranceEventType[],
  db: DbAdapter,
  getQuote: InsuranceProviderFn,
): Promise<InsuranceQuote> {
  // Load event data from DB
  const eventRows = await db.query<{
    event_date: string;
    capacity: number;
    total_ticket_revenue: number;
  }>(
    `SELECT event_date, capacity, COALESCE(total_ticket_revenue, 0) as total_ticket_revenue
     FROM events WHERE id = $1 AND promoter_id = $2`,
    [eventId, promoterId],
  );

  const eventData = eventRows[0] ?? {
    event_date: new Date().toISOString(),
    capacity: 0,
    total_ticket_revenue: 0,
  };

  const quote = await getQuote({
    eventDate: eventData.event_date,
    capacity: Number(eventData.capacity),
    totalTicketRevenue: Number(eventData.total_ticket_revenue),
    coveredEvents,
  });

  return quote;
}

/**
 * Zakoupí pojistku.
 */
export async function purchasePolicy(
  eventId: string,
  promoterId: string,
  quote: InsuranceQuote,
  provider: string,
  db: DbAdapter,
): Promise<EventInsurancePolicy> {
  // Check for existing policy for this event
  const existing = await db.query<PolicyRow>(
    `SELECT id FROM event_insurance_policies WHERE event_id = $1`,
    [eventId],
  );
  if (existing.length > 0) {
    throw new Error(`Pojistka pro event ${eventId} již existuje`);
  }

  const id = randomUUID();
  const now = new Date().toISOString();
  const coveredEventsJson = JSON.stringify(quote.coveredEvents);

  await db.execute(
    `INSERT INTO event_insurance_policies
       (id, promoter_id, event_id, provider, covered_events, coverage_amount_halire, premium_halire,
        status, coverage_from, coverage_to, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', $8, $9, $8)`,
    [
      id, promoterId, eventId, provider, coveredEventsJson,
      quote.coverageAmountHalire, quote.premiumHalire,
      now, quote.validUntil,
    ],
  );

  return {
    id,
    promoterId,
    eventId,
    provider,
    coveredEvents: quote.coveredEvents,
    coverageAmountHalire: quote.coverageAmountHalire,
    premiumHalire: quote.premiumHalire,
    status: 'active',
    coverageFrom: now,
    coverageTo: quote.validUntil,
    createdAt: now,
  };
}

/**
 * Nahlásí pojistnou událost.
 */
export async function submitClaim(
  policyId: string,
  promoterId: string,
  claimType: InsuranceEventType,
  description: string,
  requestedAmountHalire: number,
  db: DbAdapter,
): Promise<InsuranceClaim> {
  const policyRows = await db.query<PolicyRow>(
    `SELECT * FROM event_insurance_policies WHERE id = $1`,
    [policyId],
  );
  if (policyRows.length === 0) {
    throw new Error(`Pojistka ${policyId} nenalezena`);
  }

  const policy = rowToPolicy(policyRows[0]);

  if (policy.status !== 'active') {
    throw new Error(`Pojistka není aktivní (status: ${policy.status})`);
  }

  if (!policy.coveredEvents.includes(claimType)) {
    throw new Error(`Typ události "${claimType}" není kryt touto pojistkou`);
  }

  if (requestedAmountHalire > policy.coverageAmountHalire) {
    throw new Error(
      `Požadovaná částka ${requestedAmountHalire} překračuje maximální krytí ${policy.coverageAmountHalire}`,
    );
  }

  const id = randomUUID();
  const now = new Date().toISOString();

  await db.execute(
    `INSERT INTO insurance_claims
       (id, policy_id, promoter_id, event_id, claim_type, description, requested_amount_halire, status, submitted_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'submitted', $8)`,
    [id, policyId, promoterId, policy.eventId, claimType, description, requestedAmountHalire, now],
  );

  return {
    id,
    policyId,
    promoterId,
    eventId: policy.eventId,
    claimType,
    description,
    requestedAmountHalire,
    status: 'submitted',
    submittedAt: now,
  };
}

/**
 * Schválí pojistné plnění.
 */
export async function approveClaim(
  claimId: string,
  approvedAmountHalire: number,
  db: DbAdapter,
): Promise<InsuranceClaim> {
  const claimRows = await db.query<ClaimRow>(
    `SELECT ic.*, eip.coverage_amount_halire
     FROM insurance_claims ic
     JOIN event_insurance_policies eip ON eip.id = ic.policy_id
     WHERE ic.id = $1`,
    [claimId],
  );
  if (claimRows.length === 0) {
    throw new Error(`Claim ${claimId} nenalezen`);
  }

  const row = claimRows[0] as ClaimRow & { coverage_amount_halire: number };
  if (approvedAmountHalire > row.coverage_amount_halire) {
    throw new Error(
      `Schválená částka ${approvedAmountHalire} překračuje maximální krytí ${row.coverage_amount_halire}`,
    );
  }

  const now = new Date().toISOString();
  await db.execute(
    `UPDATE insurance_claims SET status = 'approved', approved_amount_halire = $2, resolved_at = $3 WHERE id = $1`,
    [claimId, approvedAmountHalire, now],
  );

  return rowToClaim({
    ...row,
    status: 'approved',
    approved_amount_halire: approvedAmountHalire,
    resolved_at: now,
  });
}

/**
 * Zamítne claim.
 */
export async function rejectClaim(
  claimId: string,
  _reason: string,
  db: DbAdapter,
): Promise<InsuranceClaim> {
  const claimRows = await db.query<ClaimRow>(
    `SELECT * FROM insurance_claims WHERE id = $1`,
    [claimId],
  );
  if (claimRows.length === 0) {
    throw new Error(`Claim ${claimId} nenalezen`);
  }

  const now = new Date().toISOString();
  await db.execute(
    `UPDATE insurance_claims SET status = 'rejected', resolved_at = $2 WHERE id = $1`,
    [claimId, now],
  );

  return rowToClaim({ ...claimRows[0], status: 'rejected', resolved_at: now });
}

/**
 * Trigger automatické náhrady pro kupující po pojistné události.
 */
export async function triggerRefundsForClaim(
  claimId: string,
  db: DbAdapter,
  refundFn: (orderId: string, amountHalire: number) => Promise<void>,
): Promise<{ refundedCount: number; totalRefundedHalire: number }> {
  const claimRows = await db.query<ClaimRow>(
    `SELECT * FROM insurance_claims WHERE id = $1`,
    [claimId],
  );
  if (claimRows.length === 0) {
    throw new Error(`Claim ${claimId} nenalezen`);
  }

  const claim = rowToClaim(claimRows[0]);
  if (claim.status !== 'approved') {
    throw new Error(`Claim není schválen (status: ${claim.status})`);
  }

  // Load all paid orders for this event
  const orderRows = await db.query<OrderRow>(
    `SELECT id, total_halire FROM orders WHERE event_id = $1 AND status = 'paid'`,
    [claim.eventId],
  );

  let refundedCount = 0;
  let totalRefundedHalire = 0;

  for (const order of orderRows) {
    await refundFn(order.id, order.total_halire);
    refundedCount++;
    totalRefundedHalire += Number(order.total_halire);
  }

  // Mark claim as paid
  await db.execute(
    `UPDATE insurance_claims SET status = 'paid' WHERE id = $1`,
    [claimId],
  );

  return { refundedCount, totalRefundedHalire };
}

/**
 * Stav pojistky pro event.
 */
export async function getPolicyForEvent(
  eventId: string,
  promoterId: string,
  db: DbAdapter,
): Promise<EventInsurancePolicy | null> {
  const rows = await db.query<PolicyRow>(
    `SELECT * FROM event_insurance_policies WHERE event_id = $1 AND promoter_id = $2`,
    [eventId, promoterId],
  );
  if (rows.length === 0) {
    return null;
  }
  return rowToPolicy(rows[0]);
}
