// ---------------------------------------------------------------------------
// Re-entry Management — shared domain types
// ---------------------------------------------------------------------------

export type GateType = 'entry' | 'exit' | 'bidirectional';

export interface ScanEvent {
  id: string;
  ticket_id: string;
  gate_id: string;
  gate_type: GateType;
  event_type: 'check_in' | 'check_out';
  scanned_at: Date;
  staff_id: string;
  allowed: boolean;
  denial_reason: string | null;
}

export interface ReentryPolicy {
  id: string;
  event_id: string;
  ticket_type_id: string | null; // null = applies to entire event
  allowed: boolean;
  max_reentries: number | null; // null = unlimited (when allowed = true)
  vip_only: boolean;            // re-entry only for VIP ticket types
  requires_exit_before_reentry: boolean;
}

export interface ReentryCheckResult {
  allowed: boolean;
  event_type: 'check_in' | 'check_out' | 'reentry';
  reentry_count: number;        // how many re-entries have already happened
  max_reentries: number | null;
  reason?: string;              // set when allowed = false
}

export interface TicketPresence {
  ticket_id: string;
  is_inside: boolean;           // true if last scan was check_in
  check_in_count: number;
  check_out_count: number;
  reentry_count: number;        // check_in_count - 1 (first entry doesn't count)
  last_scan_at: Date | null;
  last_event_type: 'check_in' | 'check_out' | null;
}

// ---------------------------------------------------------------------------
// Typed errors
// ---------------------------------------------------------------------------

export class ReentryDeniedError extends Error {
  readonly code = 'REENTRY_DENIED' as const;
  constructor(message: string) {
    super(message);
    this.name = 'ReentryDeniedError';
  }
}

export class ReentryLimitExceededError extends Error {
  readonly code = 'REENTRY_LIMIT_EXCEEDED' as const;
  readonly current: number;
  readonly max: number;
  constructor(current: number, max: number) {
    super(`Re-entry limit exceeded: ${current} of ${max} used`);
    this.name = 'ReentryLimitExceededError';
    this.current = current;
    this.max = max;
  }
}

export class ReentryWithoutExitError extends Error {
  readonly code = 'REENTRY_WITHOUT_EXIT' as const;
  constructor() {
    super('Guest must exit before re-entering');
    this.name = 'ReentryWithoutExitError';
  }
}

export class PolicyNotFoundError extends Error {
  readonly code = 'POLICY_NOT_FOUND' as const;
  constructor(eventId: string) {
    super(`No re-entry policy found for event: ${eventId}`);
    this.name = 'PolicyNotFoundError';
  }
}
