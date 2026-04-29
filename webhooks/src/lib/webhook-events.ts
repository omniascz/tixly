// ---------------------------------------------------------------------------
// Supported webhook event types
// ---------------------------------------------------------------------------

export const WEBHOOK_EVENTS = {
  // Bookings
  'booking.created': 'A booking was confirmed',
  'booking.cancelled': 'A booking was cancelled',
  'booking.completed': 'A booking was marked completed',
  'booking.no_show': 'A booking was marked no-show',
  // Slots
  'slot.opened': 'A slot became available (from full)',
  'slot.full': 'A slot became fully booked',
  'slot.closed': 'A slot was closed',
  // Packages
  'package.purchased': 'A package was purchased',
  'package.activated': 'A package was activated/gift claimed',
  'package.expired': 'A package expired',
  'package.fully_used': 'A package was fully used',
  // Waitlist
  'waitlist.notified': 'A waitlist user was notified of availability',
  // Reviews
  'review.created': 'A new review was submitted',
  // Approvals
  'approval.requested': 'An approval was requested',
  'approval.decided': 'An approval was approved or rejected',
} as const;

export type WebhookEventType = keyof typeof WEBHOOK_EVENTS;

export function isValidEventType(eventType: string): eventType is WebhookEventType {
  return eventType in WEBHOOK_EVENTS;
}
