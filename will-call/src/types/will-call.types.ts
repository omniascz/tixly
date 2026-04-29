export type WillCallStatus =
  | 'reserved'
  | 'ready_for_pickup'
  | 'picked_up'
  | 'forfeited'

export interface WillCallEntry {
  id: string
  ticket_id: string
  order_id: string
  event_id: string
  holder_name: string
  holder_email: string
  holder_phone: string | null
  ticket_type_name: string
  quantity: number
  status: WillCallStatus
  pickup_location: string | null
  pickup_window_start: Date | null
  pickup_window_end: Date | null
  notes: string | null
  picked_up_at: Date | null
  picked_up_by_staff_id: string | null
  forfeited_at: Date | null
  created_at: Date
  // Delivery tracking (optional — require schema migration to add columns:
  //   ALTER TABLE platform.will_call_entries
  //     ADD COLUMN pickup_printed_at TIMESTAMPTZ,
  //     ADD COLUMN pickup_printed_by TEXT,
  //     ADD COLUMN sms_sent_at TIMESTAMPTZ;
  // )
  pickup_printed_at?: Date | null
  pickup_printed_by?: string | null
  sms_sent_at?: Date | null
}

export interface WillCallSearchResult {
  entries: WillCallEntry[]
  total: number
}

export class WillCallNotFoundError extends Error {
  readonly code = 'WILL_CALL_NOT_FOUND'
  constructor(id: string) {
    super(`Will call entry not found: ${id}`)
    this.name = 'WillCallNotFoundError'
  }
}

export class WillCallAlreadyPickedUpError extends Error {
  readonly code = 'WILL_CALL_ALREADY_PICKED_UP'
  constructor(id: string) {
    super(`Will call entry already picked up: ${id}`)
    this.name = 'WillCallAlreadyPickedUpError'
  }
}

export class WillCallForfeitedError extends Error {
  readonly code = 'WILL_CALL_FORFEITED'
  constructor(id: string) {
    super(`Will call entry has been forfeited: ${id}`)
    this.name = 'WillCallForfeitedError'
  }
}

export class WillCallWindowClosedError extends Error {
  readonly code = 'WILL_CALL_WINDOW_CLOSED'
  constructor(id: string) {
    super(`Pickup window is closed for will call entry: ${id}`)
    this.name = 'WillCallWindowClosedError'
  }
}

export class WillCallUnauthorizedError extends Error {
  readonly code = 'WILL_CALL_UNAUTHORIZED'
  constructor(message = 'Unauthorized') {
    super(message)
    this.name = 'WillCallUnauthorizedError'
  }
}

export class WillCallPhoneRequiredError extends Error {
  readonly code = 'WILL_CALL_PHONE_REQUIRED'
  constructor(message = 'A valid E.164 phone number is required') {
    super(message)
    this.name = 'WillCallPhoneRequiredError'
  }
}

export class WillCallPrintFailedError extends Error {
  readonly code = 'WILL_CALL_PRINT_FAILED'
  constructor(message = 'Failed to generate printable ticket') {
    super(message)
    this.name = 'WillCallPrintFailedError'
  }
}

export class WillCallSmsFailedError extends Error {
  readonly code = 'WILL_CALL_SMS_FAILED'
  constructor(message = 'Failed to send SMS') {
    super(message)
    this.name = 'WillCallSmsFailedError'
  }
}
