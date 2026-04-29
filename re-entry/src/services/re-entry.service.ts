// ---------------------------------------------------------------------------
// Re-entry Service
// ---------------------------------------------------------------------------

import {
  getTicketPresence,
  determineEventType,
  checkReentryPolicy,
  buildDenialMessage,
} from '../lib/re-entry-checker';
import {
  ReentryDeniedError,
  ReentryLimitExceededError,
  ReentryWithoutExitError,
} from '../types/re-entry.types';
import type {
  GateType,
  ReentryCheckResult,
  ReentryPolicy,
  ScanEvent,
  TicketPresence,
} from '../types/re-entry.types';

// ---------------------------------------------------------------------------
// DB Adapter interface — implement with your real DB (Prisma, Drizzle, etc.)
// ---------------------------------------------------------------------------

export interface ReentryDbAdapter {
  findScanHistory(ticketId: string, eventId: string): Promise<ScanEvent[]>;
  getReentryPolicy(eventId: string, ticketTypeId: string): Promise<ReentryPolicy | null>;
  getDefaultPolicy(eventId: string): Promise<ReentryPolicy | null>;
  getTicketTypeInfo(ticketTypeId: string): Promise<{ isVip: boolean } | null>;
  recordScan(data: Omit<ScanEvent, 'id'>): Promise<ScanEvent>;
  createPolicy(data: Omit<ReentryPolicy, 'id'>): Promise<ReentryPolicy>;
  updatePolicy(id: string, data: Partial<ReentryPolicy>): Promise<ReentryPolicy>;
  listPoliciesByEvent(eventId: string): Promise<ReentryPolicy[]>;
}

// ---------------------------------------------------------------------------
// Fallback open policy — used when no policy is defined for an event
// ---------------------------------------------------------------------------

function buildFallbackPolicy(eventId: string): ReentryPolicy {
  return {
    id: 'fallback',
    event_id: eventId,
    ticket_type_id: null,
    allowed: true,
    max_reentries: null,
    vip_only: false,
    requires_exit_before_reentry: false,
  };
}

// ---------------------------------------------------------------------------
// ReentryService
// ---------------------------------------------------------------------------

export class ReentryService {
  // -------------------------------------------------------------------------
  // processScan
  // Core scanning logic. Always resolves — never throws domain errors.
  // HTTP errors are returned as `allowed: false` in the result payload.
  // Unexpected DB errors propagate to the route handler (→ 500).
  // -------------------------------------------------------------------------
  async processScan(
    ticketId: string,
    ticketTypeId: string,
    eventId: string,
    gateId: string,
    gateType: GateType,
    staffId: string,
    db: ReentryDbAdapter
  ): Promise<ReentryCheckResult> {
    // 1. Build current presence from scan history
    const scanHistory = await db.findScanHistory(ticketId, eventId);
    const presence = getTicketPresence(scanHistory, ticketId);

    // 2. Determine what type of event this scan represents
    const eventType = determineEventType(gateType, presence);

    // 3. Check-out is always allowed — exits cannot be blocked
    if (eventType === 'check_out') {
      const result: ReentryCheckResult = {
        allowed: true,
        event_type: 'check_out',
        reentry_count: presence.reentry_count,
        max_reentries: null,
      };

      await db.recordScan({
        ticket_id: ticketId,
        gate_id: gateId,
        gate_type: gateType,
        event_type: 'check_out',
        scanned_at: new Date(),
        staff_id: staffId,
        allowed: true,
        denial_reason: null,
      });

      return result;
    }

    // 4. Resolve policy: specific ticket type → default event → fallback
    const ticketTypePolicy = await db.getReentryPolicy(eventId, ticketTypeId);
    const policy =
      ticketTypePolicy ??
      (await db.getDefaultPolicy(eventId)) ??
      buildFallbackPolicy(eventId);

    // 5. For check_in (first entry) just allow without policy check
    if (eventType === 'check_in') {
      const result: ReentryCheckResult = {
        allowed: true,
        event_type: 'check_in',
        reentry_count: 0,
        max_reentries: policy.max_reentries,
      };

      await db.recordScan({
        ticket_id: ticketId,
        gate_id: gateId,
        gate_type: gateType,
        event_type: 'check_in',
        scanned_at: new Date(),
        staff_id: staffId,
        allowed: true,
        denial_reason: null,
      });

      return result;
    }

    // 6. Re-entry: check policy
    const isVip =
      (await db.getTicketTypeInfo(ticketTypeId))?.isVip ?? false;

    try {
      const policyResult = checkReentryPolicy(policy, presence, isVip);

      await db.recordScan({
        ticket_id: ticketId,
        gate_id: gateId,
        gate_type: gateType,
        event_type: 'check_in',
        scanned_at: new Date(),
        staff_id: staffId,
        allowed: true,
        denial_reason: null,
      });

      return {
        ...policyResult,
        event_type: 'reentry',
        reentry_count: policyResult.reentry_count + 1,
      };
    } catch (err) {
      let reason: string;

      if (err instanceof ReentryDeniedError) {
        reason = err.message;
      } else if (err instanceof ReentryLimitExceededError) {
        reason = buildDenialMessage('reentry_limit_exceeded', 'cs');
      } else if (err instanceof ReentryWithoutExitError) {
        reason = buildDenialMessage('reentry_without_exit', 'cs');
      } else {
        throw err; // unexpected — propagate to route handler
      }

      await db.recordScan({
        ticket_id: ticketId,
        gate_id: gateId,
        gate_type: gateType,
        event_type: 'check_in',
        scanned_at: new Date(),
        staff_id: staffId,
        allowed: false,
        denial_reason: reason,
      });

      return {
        allowed: false,
        event_type: 'reentry',
        reentry_count: presence.reentry_count,
        max_reentries: policy.max_reentries,
        reason,
      };
    }
  }

  // -------------------------------------------------------------------------
  // setPolicy
  // Creates or updates a re-entry policy for an event.
  // When a policy with the same event_id + ticket_type_id already exists,
  // the caller should pass the existing policy ID for an update.
  // -------------------------------------------------------------------------
  async setPolicy(
    eventId: string,
    _organizerId: string,
    data: Omit<ReentryPolicy, 'id' | 'event_id'>,
    db: ReentryDbAdapter
  ): Promise<ReentryPolicy> {
    // Check if a policy already exists for this event + ticket_type combination
    const existing = data.ticket_type_id
      ? await db.getReentryPolicy(eventId, data.ticket_type_id)
      : await db.getDefaultPolicy(eventId);

    if (existing) {
      return db.updatePolicy(existing.id, data);
    }

    return db.createPolicy({ ...data, event_id: eventId });
  }

  // -------------------------------------------------------------------------
  // listEventPolicies
  // Returns all re-entry policies for an event.
  // -------------------------------------------------------------------------
  async listEventPolicies(
    eventId: string,
    db: ReentryDbAdapter
  ): Promise<ReentryPolicy[]> {
    return db.listPoliciesByEvent(eventId);
  }

  // -------------------------------------------------------------------------
  // getTicketPresenceStatus
  // Returns current presence state for a ticket at an event.
  // -------------------------------------------------------------------------
  async getTicketPresenceStatus(
    ticketId: string,
    eventId: string,
    db: ReentryDbAdapter
  ): Promise<TicketPresence> {
    const scanHistory = await db.findScanHistory(ticketId, eventId);
    return getTicketPresence(scanHistory, ticketId);
  }
}
