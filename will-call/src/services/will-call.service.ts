import {
  WillCallEntry,
  WillCallSearchResult,
  WillCallStatus,
  WillCallNotFoundError,
  WillCallAlreadyPickedUpError,
  WillCallForfeitedError,
  WillCallWindowClosedError,
} from '../types/will-call.types'
import {
  canPickUp,
  normalizeSearchQuery,
  shouldForfeiture,
} from '../lib/will-call-validator'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface WillCallDbAdapter {
  findEntryByTicketId(ticketId: string): Promise<WillCallEntry | null>
  findEntryById(id: string): Promise<WillCallEntry | null>
  searchEntries(
    eventId: string,
    query: string,
    status?: WillCallStatus,
  ): Promise<WillCallEntry[]>
  createEntry(
    data: Omit<WillCallEntry, 'id' | 'created_at'>,
  ): Promise<WillCallEntry>
  updateEntry(id: string, data: Partial<WillCallEntry>): Promise<WillCallEntry>
  findReadyForPickup(eventId: string): Promise<WillCallEntry[]>
  findForfeitableEntries(eventId: string, now: Date): Promise<WillCallEntry[]>
  markBulkStatus(
    ids: string[],
    status: WillCallStatus,
    updatedFields: Partial<WillCallEntry>,
  ): Promise<number>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  withTransaction<T>(fn: (tx: any) => Promise<T>): Promise<T>
}

export interface HolderData {
  name: string
  email: string
  phone?: string
}

export interface RegisterOptions {
  pickupLocation?: string
  pickupWindowStart?: Date
  pickupWindowEnd?: Date
  notes?: string
  quantity?: number
}

export interface EventSummary {
  reserved: number
  ready: number
  pickedUp: number
  forfeited: number
  total: number
}

export class WillCallService {
  async registerForWillCall(
    ticketId: string,
    eventId: string,
    holderData: HolderData,
    options: RegisterOptions,
    db: WillCallDbAdapter,
  ): Promise<WillCallEntry> {
    const existing = await db.findEntryByTicketId(ticketId)
    if (existing) {
      return existing
    }

    const entry = await db.createEntry({
      ticket_id: ticketId,
      order_id: '',
      event_id: eventId,
      holder_name: holderData.name,
      holder_email: holderData.email,
      holder_phone: holderData.phone ?? null,
      ticket_type_name: '',
      quantity: options.quantity ?? 1,
      status: 'reserved',
      pickup_location: options.pickupLocation ?? null,
      pickup_window_start: options.pickupWindowStart ?? null,
      pickup_window_end: options.pickupWindowEnd ?? null,
      notes: options.notes ?? null,
      picked_up_at: null,
      picked_up_by_staff_id: null,
      forfeited_at: null,
    })

    return entry
  }

  async markReadyForPickup(
    eventId: string,
    _staffId: string,
    db: WillCallDbAdapter,
  ): Promise<number> {
    const reserved = await db.searchEntries(eventId, '', 'reserved')
    if (reserved.length === 0) return 0

    const ids = reserved.map((e) => e.id)
    const count = await db.markBulkStatus(ids, 'ready_for_pickup', {})
    return count
  }

  async recordPickup(
    entryId: string,
    staffId: string,
    db: WillCallDbAdapter,
  ): Promise<WillCallEntry> {
    const entry = await db.findEntryById(entryId)
    if (!entry) throw new WillCallNotFoundError(entryId)

    const now = new Date()
    const check = canPickUp(entry, now)

    if (!check.allowed) {
      if (check.reason === 'already_picked_up') {
        throw new WillCallAlreadyPickedUpError(entryId)
      }
      if (check.reason === 'forfeited') {
        throw new WillCallForfeitedError(entryId)
      }
      throw new WillCallWindowClosedError(entryId)
    }

    return await db.withTransaction(async (tx) => {
      const fresh = await tx.findEntryById(entryId)
      if (!fresh) throw new WillCallNotFoundError(entryId)

      const reCheck = canPickUp(fresh, now)
      if (!reCheck.allowed) {
        if (reCheck.reason === 'already_picked_up') throw new WillCallAlreadyPickedUpError(entryId)
        if (reCheck.reason === 'forfeited') throw new WillCallForfeitedError(entryId)
        throw new WillCallWindowClosedError(entryId)
      }

      return tx.updateEntry(entryId, {
        status: 'picked_up',
        picked_up_at: now,
        picked_up_by_staff_id: staffId,
      })
    })
  }

  async searchGuests(
    eventId: string,
    query: string,
    status: WillCallStatus | undefined,
    db: WillCallDbAdapter,
  ): Promise<WillCallSearchResult> {
    const normalized = normalizeSearchQuery(query)
    const entries = await db.searchEntries(eventId, normalized, status)
    return { entries, total: entries.length }
  }

  async forfeitExpired(
    eventId: string,
    db: WillCallDbAdapter,
  ): Promise<number> {
    const now = new Date()
    const candidates = await db.findForfeitableEntries(eventId, now)

    const toForfeiture = candidates.filter((e) => shouldForfeiture(e, now))
    if (toForfeiture.length === 0) return 0

    const ids = toForfeiture.map((e) => e.id)
    return db.markBulkStatus(ids, 'forfeited', { forfeited_at: now })
  }

  async getEventSummary(
    eventId: string,
    db: WillCallDbAdapter,
  ): Promise<EventSummary> {
    const [reservedEntries, readyEntries, pickedUpEntries, forfeitedEntries] =
      await Promise.all([
        db.searchEntries(eventId, '', 'reserved'),
        db.searchEntries(eventId, '', 'ready_for_pickup'),
        db.searchEntries(eventId, '', 'picked_up'),
        db.searchEntries(eventId, '', 'forfeited'),
      ])

    const reserved = reservedEntries.length
    const ready = readyEntries.length
    const pickedUp = pickedUpEntries.length
    const forfeited = forfeitedEntries.length

    return {
      reserved,
      ready,
      pickedUp,
      forfeited,
      total: reserved + ready + pickedUp + forfeited,
    }
  }
}

export const willCallService = new WillCallService()
