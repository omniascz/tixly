// ---------------------------------------------------------------------------
// Re-entry Checker — pure functions for re-entry logic
// ---------------------------------------------------------------------------

import type {
  GateType,
  ReentryCheckResult,
  ReentryPolicy,
  ScanEvent,
  TicketPresence,
} from '../types/re-entry.types';
import {
  ReentryDeniedError,
  ReentryLimitExceededError,
  ReentryWithoutExitError,
} from '../types/re-entry.types';

// ---------------------------------------------------------------------------
// Denial messages
// ---------------------------------------------------------------------------

const DENIAL_MESSAGES: Record<string, Record<'cs' | 'en', string>> = {
  reentry_denied: {
    cs: 'Re-entry je pro tuto akci zakázáno.',
    en: 'Re-entry is not permitted for this event.',
  },
  reentry_vip_only: {
    cs: 'Re-entry je povoleno pouze pro VIP vstupenky.',
    en: 'Re-entry is available for VIP tickets only.',
  },
  reentry_limit_exceeded: {
    cs: 'Byl překročen maximální počet re-entry.',
    en: 'Maximum re-entry limit has been reached.',
  },
  reentry_without_exit: {
    cs: 'Nejprve musíte opustit akci, než se budete moci vrátit.',
    en: 'You must exit the event before re-entering.',
  },
  unknown: {
    cs: 'Vstup byl odepřen.',
    en: 'Entry was denied.',
  },
};

// ---------------------------------------------------------------------------
// getTicketPresence
// Calculates current presence state from full scan history.
// Only allowed scans are counted for presence calculation.
// ---------------------------------------------------------------------------

export function getTicketPresence(
  scanHistory: ScanEvent[],
  ticketId: string
): TicketPresence {
  // Only consider allowed scans for presence state
  const allowedScans = scanHistory
    .filter((s) => s.allowed)
    .sort((a, b) => new Date(a.scanned_at).getTime() - new Date(b.scanned_at).getTime());

  let checkInCount = 0;
  let checkOutCount = 0;
  let lastScanAt: Date | null = null;
  let lastEventType: 'check_in' | 'check_out' | null = null;

  for (const scan of allowedScans) {
    if (scan.event_type === 'check_in') {
      checkInCount++;
    } else {
      checkOutCount++;
    }
    lastScanAt = new Date(scan.scanned_at);
    lastEventType = scan.event_type;
  }

  const isInside = lastEventType === 'check_in';
  const reentryCount = Math.max(0, checkInCount - 1);

  return {
    ticket_id: ticketId,
    is_inside: isInside,
    check_in_count: checkInCount,
    check_out_count: checkOutCount,
    reentry_count: reentryCount,
    last_scan_at: lastScanAt,
    last_event_type: lastEventType,
  };
}

// ---------------------------------------------------------------------------
// determineEventType
// Determines whether a scan is a check_in, check_out, or reentry.
//
// Rules:
//  EXIT gate           → always check_out
//  ENTRY gate, no prior entry → check_in (first visit)
//  ENTRY gate, was inside + exited → reentry
//  ENTRY gate, was inside (no exit) → still reentry attempt (policy will block if needed)
//  BIDIRECTIONAL gate → if currently inside → check_out; else → check_in or reentry
// ---------------------------------------------------------------------------

export function determineEventType(
  gateType: GateType,
  presence: TicketPresence
): 'check_in' | 'check_out' | 'reentry' {
  if (gateType === 'exit') {
    return 'check_out';
  }

  if (gateType === 'bidirectional') {
    if (presence.is_inside) {
      return 'check_out';
    }
    // Outside: first time or returning
    if (presence.check_in_count === 0) {
      return 'check_in';
    }
    return 'reentry';
  }

  // ENTRY gate
  if (presence.check_in_count === 0) {
    return 'check_in';
  }
  return 'reentry';
}

// ---------------------------------------------------------------------------
// checkReentryPolicy
// Validates a re-entry attempt against the policy. Throws typed errors on
// denial. Returns ReentryCheckResult on success.
// ---------------------------------------------------------------------------

export function checkReentryPolicy(
  policy: ReentryPolicy,
  presence: TicketPresence,
  isVip: boolean
): ReentryCheckResult {
  // Policy: re-entry completely disallowed
  if (!policy.allowed) {
    throw new ReentryDeniedError(buildDenialMessage('reentry_denied', 'cs'));
  }

  // Policy: VIP only
  if (policy.vip_only && !isVip) {
    throw new ReentryDeniedError(buildDenialMessage('reentry_vip_only', 'cs'));
  }

  // Policy: must exit before re-entering
  if (policy.requires_exit_before_reentry && presence.is_inside) {
    throw new ReentryWithoutExitError();
  }

  // Policy: max re-entries limit
  if (
    policy.max_reentries !== null &&
    presence.reentry_count >= policy.max_reentries
  ) {
    throw new ReentryLimitExceededError(presence.reentry_count, policy.max_reentries);
  }

  return {
    allowed: true,
    event_type: 'reentry',
    reentry_count: presence.reentry_count,
    max_reentries: policy.max_reentries,
  };
}

// ---------------------------------------------------------------------------
// buildDenialMessage
// Returns a localised denial message for a given reason code.
// ---------------------------------------------------------------------------

export function buildDenialMessage(reason: string, lang: 'cs' | 'en'): string {
  const messages = DENIAL_MESSAGES[reason];
  if (!messages) {
    return DENIAL_MESSAGES['unknown']![lang];
  }
  return messages[lang];
}
