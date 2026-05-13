import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import type { WillCallEntry } from '../types/will-call.types'
import type { WillCallDbAdapter } from '../services/will-call.service'
import { __setWillCallDeps } from '../lib/service-container'
import { POST as printPost } from '../app/api/will-call/[entryId]/print/route'
import { POST as smsPost } from '../app/api/will-call/[entryId]/sms/route'
import { WillCallService } from '../services/will-call.service.js'
import {
  WillCallNotFoundError,
  WillCallAlreadyPickedUpError,
  WillCallForfeitedError,
  WillCallWindowClosedError,
} from '../types/will-call.types.js'
import { GET as searchGet, POST as registerPost } from '../app/api/events/[eventId]/will-call/route.js'
import { POST as pickupPost } from '../app/api/will-call/[entryId]/pickup/route.js'
import { GET as summaryGet } from '../app/api/events/[eventId]/will-call/summary/route.js'

function makeEntry(overrides: Partial<WillCallEntry> = {}): WillCallEntry {
  return {
    id: 'entry-1',
    ticket_id: 'ticket-1',
    order_id: 'order-1',
    event_id: 'event-1',
    holder_name: 'Jan Novák',
    holder_email: 'jan@example.com',
    holder_phone: '+420777123456',
    ticket_type_name: 'Standard',
    quantity: 1,
    status: 'ready_for_pickup',
    pickup_location: null,
    pickup_window_start: null,
    pickup_window_end: null,
    notes: null,
    picked_up_at: null,
    picked_up_by_staff_id: null,
    forfeited_at: null,
    created_at: new Date('2026-04-04T10:00:00Z'),
    pickup_printed_at: null,
    pickup_printed_by: null,
    sms_sent_at: null,
    ...overrides,
  }
}

function makeDb(entry: WillCallEntry | null): WillCallDbAdapter {
  return {
    findEntryById: vi.fn(async () => entry),
    findEntryByTicketId: vi.fn(async () => entry),
    searchEntries: vi.fn(async () => []),
    createEntry: vi.fn(async () => entry as WillCallEntry),
    updateEntry: vi.fn(async (_id, data) => ({ ...(entry as WillCallEntry), ...data })),
    findReadyForPickup: vi.fn(async () => []),
    findForfeitableEntries: vi.fn(async () => []),
    markBulkStatus: vi.fn(async () => 0),
    withTransaction: vi.fn(async (fn) => fn({
      findEntryById: async () => entry,
      updateEntry: async (_id: string, data: Partial<WillCallEntry>) => ({ ...(entry as WillCallEntry), ...data }),
    })),
  }
}

function req(url: string, body?: unknown, headers: Record<string, string> = { 'x-staff-id': 'staff-1' }): NextRequest {
  return new NextRequest(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
}

afterEach(() => {
  __setWillCallDeps(undefined)
  vi.restoreAllMocks()
})

// ── Print endpoint ──────────────────────────────────────────────────────────
describe('POST /api/will-call/[entryId]/print', () => {
  beforeEach(() => {
    __setWillCallDeps(undefined)
  })

  it('returns printUrl for a ready entry', async () => {
    const entry = makeEntry({ status: 'ready_for_pickup' })
    const db = makeDb(entry)
    __setWillCallDeps({ db })

    const res = await printPost(
      req('http://localhost/api/will-call/entry-1/print'),
      { params: Promise.resolve({ entryId: 'entry-1' }) },
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.printUrl).toBe('/api/tickets/ticket-1/pdf')
    expect(json.printedAt).toBeTruthy()
    expect(db.updateEntry).toHaveBeenCalledWith(
      'entry-1',
      expect.objectContaining({ pickup_printed_by: 'staff-1' }),
    )
  })

  it('returns 400 for a picked_up entry', async () => {
    const entry = makeEntry({ status: 'picked_up' })
    __setWillCallDeps({ db: makeDb(entry) })

    const res = await printPost(
      req('http://localhost/api/will-call/entry-1/print'),
      { params: Promise.resolve({ entryId: 'entry-1' }) },
    )
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.code).toBe('WILL_CALL_ALREADY_PICKED_UP')
  })

  it('returns 404 for a missing entry', async () => {
    __setWillCallDeps({ db: makeDb(null) })

    const res = await printPost(
      req('http://localhost/api/will-call/missing/print'),
      { params: Promise.resolve({ entryId: 'missing' }) },
    )
    expect(res.status).toBe(404)
  })
})

// ── SMS endpoint ────────────────────────────────────────────────────────────
describe('POST /api/will-call/[entryId]/sms', () => {
  beforeEach(() => {
    __setWillCallDeps(undefined)
  })

  it('sends SMS via upstream fetch and records sms_sent_at', async () => {
    const entry = makeEntry()
    const db = makeDb(entry)
    __setWillCallDeps({ db })

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ sent: true, messageId: 'msg-42' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )

    const res = await smsPost(
      req('http://localhost/api/will-call/entry-1/sms', {}),
      { params: Promise.resolve({ entryId: 'entry-1' }) },
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.sent).toBe(true)
    expect(json.messageId).toBe('msg-42')
    expect(fetchMock).toHaveBeenCalled()
    const fetchBody = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
    expect(fetchBody.phone).toBe('+420777123456')
    expect(db.updateEntry).toHaveBeenCalledWith(
      'entry-1',
      expect.objectContaining({ sms_sent_at: expect.any(Date) }),
    )
  })

  it('uses phone override from body when provided', async () => {
    const entry = makeEntry({ holder_phone: null })
    __setWillCallDeps({ db: makeDb(entry) })

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ sent: true, messageId: 'ok' }), { status: 200 }),
    )

    const res = await smsPost(
      req('http://localhost/api/will-call/entry-1/sms', { phone: '+420600111222' }),
      { params: Promise.resolve({ entryId: 'entry-1' }) },
    )
    expect(res.status).toBe(200)
    const sent = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
    expect(sent.phone).toBe('+420600111222')
  })

  it('returns 400 PHONE_REQUIRED when no phone available', async () => {
    const entry = makeEntry({ holder_phone: null })
    __setWillCallDeps({ db: makeDb(entry) })

    const res = await smsPost(
      req('http://localhost/api/will-call/entry-1/sms', {}),
      { params: Promise.resolve({ entryId: 'entry-1' }) },
    )
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.code).toBe('WILL_CALL_PHONE_REQUIRED')
  })

  it('returns 400 PHONE_REQUIRED when phone is not E.164', async () => {
    const entry = makeEntry({ holder_phone: '777123456' })
    __setWillCallDeps({ db: makeDb(entry) })

    const res = await smsPost(
      req('http://localhost/api/will-call/entry-1/sms', {}),
      { params: Promise.resolve({ entryId: 'entry-1' }) },
    )
    expect(res.status).toBe(400)
  })

  it('returns 404 for a missing entry', async () => {
    __setWillCallDeps({ db: makeDb(null) })

    const res = await smsPost(
      req('http://localhost/api/will-call/missing/sms', { phone: '+420600111222' }),
      { params: Promise.resolve({ entryId: 'missing' }) },
    )
    expect(res.status).toBe(404)
  })

  it('returns 502 when upstream SMS delivery fails', async () => {
    const entry = makeEntry()
    const db = makeDb(entry)
    __setWillCallDeps({ db })

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ sent: false, error: 'provider down' }), { status: 502 }),
    )

    const res = await smsPost(
      req('http://localhost/api/will-call/entry-1/sms', {}),
      { params: Promise.resolve({ entryId: 'entry-1' }) },
    )
    expect(res.status).toBe(502)
    const json = await res.json()
    expect(json.sent).toBe(false)
    expect(db.updateEntry).not.toHaveBeenCalled()
  })
})

// ── WillCallService — unit tests ────────────────────────────────────────────

const service = new WillCallService()

describe('WillCallService.registerForWillCall', () => {
  it('creates new entry when ticket has no existing will-call record', async () => {
    const created = makeEntry({ status: 'reserved' })
    const db: WillCallDbAdapter = {
      ...makeDb(null),
      createEntry: vi.fn(async () => created),
    }

    const result = await service.registerForWillCall(
      'ticket-new',
      'event-1',
      { name: 'Jan Novák', email: 'jan@example.com', phone: '+420777000000' },
      { quantity: 2, pickupLocation: 'Entrance A' },
      db,
    )

    expect(db.createEntry).toHaveBeenCalledOnce()
    const createArg = (db.createEntry as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(createArg.ticket_id).toBe('ticket-new')
    expect(createArg.event_id).toBe('event-1')
    expect(createArg.holder_name).toBe('Jan Novák')
    expect(createArg.holder_email).toBe('jan@example.com')
    expect(createArg.holder_phone).toBe('+420777000000')
    expect(createArg.quantity).toBe(2)
    expect(createArg.status).toBe('reserved')
    expect(createArg.pickup_location).toBe('Entrance A')
    expect(result).toBe(created)
  })

  it('returns existing entry (idempotent) when ticket already registered', async () => {
    const existing = makeEntry({ status: 'reserved' })
    const db: WillCallDbAdapter = {
      ...makeDb(existing),
      createEntry: vi.fn(),
    }

    const result = await service.registerForWillCall(
      'ticket-1',
      'event-1',
      { name: 'Jan Novák', email: 'jan@example.com' },
      {},
      db,
    )

    expect(db.createEntry).not.toHaveBeenCalled()
    expect(result).toBe(existing)
  })
})

describe('WillCallService.searchGuests', () => {
  it('normalises Czech diacritics in query before passing to db', async () => {
    const db = makeDb(makeEntry())
    ;(db.searchEntries as ReturnType<typeof vi.fn>).mockResolvedValue([makeEntry()])

    const result = await service.searchGuests('event-1', 'Novák', undefined, db)

    expect(db.searchEntries).toHaveBeenCalledWith('event-1', 'novak', undefined)
    expect(result.entries).toHaveLength(1)
    expect(result.total).toBe(1)
  })

  it('filters by status when provided', async () => {
    const db = makeDb(makeEntry())
    ;(db.searchEntries as ReturnType<typeof vi.fn>).mockResolvedValue([makeEntry()])

    await service.searchGuests('event-1', 'jan', 'ready_for_pickup', db)

    expect(db.searchEntries).toHaveBeenCalledWith('event-1', 'jan', 'ready_for_pickup')
  })

  it('returns empty result set when no entries match', async () => {
    const db = makeDb(null)
    ;(db.searchEntries as ReturnType<typeof vi.fn>).mockResolvedValue([])

    const result = await service.searchGuests('event-1', 'nobody', undefined, db)

    expect(result.entries).toHaveLength(0)
    expect(result.total).toBe(0)
  })
})

describe('WillCallService.recordPickup', () => {
  it('marks entry as picked_up and sets picked_up_at + staff', async () => {
    const entry = makeEntry({ status: 'ready_for_pickup' })
    const db = makeDb(entry)

    const result = await service.recordPickup('entry-1', 'staff-99', db)

    expect(db.withTransaction).toHaveBeenCalledOnce()
    expect(result.status).toBe('picked_up')
    expect(result.picked_up_by_staff_id).toBe('staff-99')
    expect(result.picked_up_at).toBeInstanceOf(Date)
  })

  it('throws WillCallNotFoundError for non-existent entry', async () => {
    const db = makeDb(null)

    await expect(service.recordPickup('missing', 'staff-1', db)).rejects.toThrow(WillCallNotFoundError)
  })

  it('throws WillCallAlreadyPickedUpError when entry is already picked_up', async () => {
    const entry = makeEntry({ status: 'picked_up', picked_up_at: new Date() })
    const db = makeDb(entry)

    await expect(service.recordPickup('entry-1', 'staff-1', db)).rejects.toThrow(WillCallAlreadyPickedUpError)
  })

  it('throws WillCallForfeitedError when entry is forfeited', async () => {
    const entry = makeEntry({ status: 'forfeited', forfeited_at: new Date() })
    const db = makeDb(entry)

    await expect(service.recordPickup('entry-1', 'staff-1', db)).rejects.toThrow(WillCallForfeitedError)
  })

  it('throws WillCallWindowClosedError when pickup window has passed', async () => {
    const past = new Date(Date.now() - 1000 * 60 * 60) // 1 hour ago
    const entry = makeEntry({
      status: 'ready_for_pickup',
      pickup_window_end: past,
    })
    const db = makeDb(entry)

    await expect(service.recordPickup('entry-1', 'staff-1', db)).rejects.toThrow(WillCallWindowClosedError)
  })
})

describe('WillCallService.forfeitExpired', () => {
  it('forfeits entries whose pickup window has closed', async () => {
    const past = new Date(Date.now() - 3600_000)
    const e1 = makeEntry({ id: 'e1', status: 'ready_for_pickup', pickup_window_end: past })
    const e2 = makeEntry({ id: 'e2', status: 'ready_for_pickup', pickup_window_end: past })
    const db = makeDb(e1)
    ;(db.findForfeitableEntries as ReturnType<typeof vi.fn>).mockResolvedValue([e1, e2])
    ;(db.markBulkStatus as ReturnType<typeof vi.fn>).mockResolvedValue(2)

    const count = await service.forfeitExpired('event-1', db)

    expect(count).toBe(2)
    expect(db.markBulkStatus).toHaveBeenCalledWith(
      ['e1', 'e2'],
      'forfeited',
      expect.objectContaining({ forfeited_at: expect.any(Date) }),
    )
  })

  it('returns 0 when no forfeitable entries exist', async () => {
    const db = makeDb(null)
    ;(db.findForfeitableEntries as ReturnType<typeof vi.fn>).mockResolvedValue([])

    const count = await service.forfeitExpired('event-1', db)

    expect(count).toBe(0)
    expect(db.markBulkStatus).not.toHaveBeenCalled()
  })
})

describe('WillCallService.getEventSummary', () => {
  it('returns correct counts for each status', async () => {
    const reserved = [makeEntry({ id: 'r1', status: 'reserved' }), makeEntry({ id: 'r2', status: 'reserved' })]
    const ready = [makeEntry({ id: 'p1', status: 'ready_for_pickup' })]
    const pickedUp = [makeEntry({ id: 'u1', status: 'picked_up' }), makeEntry({ id: 'u2', status: 'picked_up' }), makeEntry({ id: 'u3', status: 'picked_up' })]
    const forfeited: WillCallEntry[] = []

    const db = makeDb(null)
    ;(db.searchEntries as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(reserved)
      .mockResolvedValueOnce(ready)
      .mockResolvedValueOnce(pickedUp)
      .mockResolvedValueOnce(forfeited)

    const summary = await service.getEventSummary('event-1', db)

    expect(summary.reserved).toBe(2)
    expect(summary.ready).toBe(1)
    expect(summary.pickedUp).toBe(3)
    expect(summary.forfeited).toBe(0)
    expect(summary.total).toBe(6)
  })

  it('total equals sum of all individual status counts', async () => {
    const db = makeDb(null)
    ;(db.searchEntries as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([makeEntry()])        // reserved
      .mockResolvedValueOnce([makeEntry(), makeEntry()]) // ready
      .mockResolvedValueOnce([makeEntry()])        // picked_up
      .mockResolvedValueOnce([makeEntry()])        // forfeited

    const summary = await service.getEventSummary('event-1', db)

    expect(summary.total).toBe(summary.reserved + summary.ready + summary.pickedUp + summary.forfeited)
  })
})

// ── Route-level tests ───────────────────────────────────────────────────────

function getReq(url: string, headers: Record<string, string> = { 'x-staff-id': 'staff-1' }): NextRequest {
  return new NextRequest(url, { method: 'GET', headers })
}

describe('POST /api/events/[eventId]/will-call — register', () => {
  it('returns 201 with created entry on valid payload', async () => {
    const created = makeEntry({ status: 'reserved' })
    const db = makeDb(null)
    ;(db.findEntryByTicketId as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    ;(db.createEntry as ReturnType<typeof vi.fn>).mockResolvedValue(created)
    __setWillCallDeps({ db })

    const res = await registerPost(
      new NextRequest('http://localhost/api/events/event-1/will-call', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-staff-id': 'staff-1' },
        body: JSON.stringify({
          ticket_id: 'ticket-new',
          order_id: 'order-new',
          holder_name: 'Jan Novák',
          holder_email: 'jan@example.com',
          ticket_type_name: 'Standard',
        }),
      }),
      { params: Promise.resolve({ eventId: 'event-1' }) },
    )

    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.id).toBe('entry-1')
  })

  it('returns 400 when Zod validation fails (missing required fields)', async () => {
    __setWillCallDeps({ db: makeDb(null) })

    const res = await registerPost(
      new NextRequest('http://localhost/api/events/event-1/will-call', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-staff-id': 'staff-1' },
        body: JSON.stringify({ holder_name: 'Jan' }), // missing ticket_id, order_id, email, type
      }),
      { params: Promise.resolve({ eventId: 'event-1' }) },
    )

    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBe('Validation failed')
  })

  it('returns 401 when no auth header is present', async () => {
    __setWillCallDeps({ db: makeDb(null) })

    const res = await registerPost(
      new NextRequest('http://localhost/api/events/event-1/will-call', {
        method: 'POST',
        headers: { 'content-type': 'application/json' }, // no x-staff-id or x-user-id
        body: JSON.stringify({
          ticket_id: 'ticket-new',
          order_id: 'order-new',
          holder_name: 'Jan',
          holder_email: 'jan@example.com',
          ticket_type_name: 'Standard',
        }),
      }),
      { params: Promise.resolve({ eventId: 'event-1' }) },
    )

    expect(res.status).toBe(401)
  })
})

describe('POST /api/will-call/[entryId]/pickup', () => {
  it('returns 200 with entry and Czech confirmation on success', async () => {
    const entry = makeEntry({ status: 'ready_for_pickup' })
    __setWillCallDeps({ db: makeDb(entry) })

    const res = await pickupPost(
      new NextRequest('http://localhost/api/will-call/entry-1/pickup', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-staff-id': 'staff-1' },
        body: JSON.stringify({ staff_id: 'staff-1', lang: 'cs' }),
      }),
      { params: Promise.resolve({ entryId: 'entry-1' }) },
    )

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.entry).toBeDefined()
    expect(json.confirmation).toContain('Jan Novák')
  })

  it('returns 409 when entry is already picked_up', async () => {
    const entry = makeEntry({ status: 'picked_up', picked_up_at: new Date() })
    __setWillCallDeps({ db: makeDb(entry) })

    const res = await pickupPost(
      new NextRequest('http://localhost/api/will-call/entry-1/pickup', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-staff-id': 'staff-1' },
        body: JSON.stringify({ staff_id: 'staff-1' }),
      }),
      { params: Promise.resolve({ entryId: 'entry-1' }) },
    )

    expect(res.status).toBe(409)
    const json = await res.json()
    expect(json.code).toBe('WILL_CALL_ALREADY_PICKED_UP')
  })

  it('returns 410 when entry is forfeited', async () => {
    const entry = makeEntry({ status: 'forfeited', forfeited_at: new Date() })
    __setWillCallDeps({ db: makeDb(entry) })

    const res = await pickupPost(
      new NextRequest('http://localhost/api/will-call/entry-1/pickup', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-staff-id': 'staff-1' },
        body: JSON.stringify({ staff_id: 'staff-1' }),
      }),
      { params: Promise.resolve({ entryId: 'entry-1' }) },
    )

    expect(res.status).toBe(410)
    const json = await res.json()
    expect(json.code).toBe('WILL_CALL_FORFEITED')
  })

  it('returns 400 when Zod validation fails (missing staff_id)', async () => {
    __setWillCallDeps({ db: makeDb(makeEntry()) })

    const res = await pickupPost(
      new NextRequest('http://localhost/api/will-call/entry-1/pickup', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-staff-id': 'staff-1' },
        body: JSON.stringify({}), // missing staff_id
      }),
      { params: Promise.resolve({ entryId: 'entry-1' }) },
    )

    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBe('Validation failed')
  })

  it('returns 401 when x-staff-id header is absent', async () => {
    __setWillCallDeps({ db: makeDb(makeEntry()) })

    const res = await pickupPost(
      new NextRequest('http://localhost/api/will-call/entry-1/pickup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' }, // no x-staff-id
        body: JSON.stringify({ staff_id: 'staff-1' }),
      }),
      { params: Promise.resolve({ entryId: 'entry-1' }) },
    )

    expect(res.status).toBe(401)
  })
})

describe('GET /api/events/[eventId]/will-call/summary', () => {
  it('returns correct summary object with all counts', async () => {
    const reserved = [makeEntry({ id: 'r1', status: 'reserved' })]
    const ready = [makeEntry({ id: 'p1', status: 'ready_for_pickup' }), makeEntry({ id: 'p2', status: 'ready_for_pickup' })]
    const pickedUp = [makeEntry({ id: 'u1', status: 'picked_up' })]
    const forfeited = [makeEntry({ id: 'f1', status: 'forfeited' })]

    const db = makeDb(null)
    ;(db.searchEntries as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(reserved)
      .mockResolvedValueOnce(ready)
      .mockResolvedValueOnce(pickedUp)
      .mockResolvedValueOnce(forfeited)
    __setWillCallDeps({ db })

    const res = await summaryGet(
      getReq('http://localhost/api/events/event-1/will-call/summary'),
      { params: Promise.resolve({ eventId: 'event-1' }) },
    )

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.reserved).toBe(1)
    expect(json.ready).toBe(2)
    expect(json.pickedUp).toBe(1)
    expect(json.forfeited).toBe(1)
    expect(json.total).toBe(5)
  })

  it('returns 401 when no auth header', async () => {
    __setWillCallDeps({ db: makeDb(null) })

    const res = await summaryGet(
      getReq('http://localhost/api/events/event-1/will-call/summary', {}),
      { params: Promise.resolve({ eventId: 'event-1' }) },
    )

    expect(res.status).toBe(401)
  })
})

describe('GET /api/events/[eventId]/will-call — search', () => {
  it('returns 200 with entries array', async () => {
    const db = makeDb(makeEntry())
    ;(db.searchEntries as ReturnType<typeof vi.fn>).mockResolvedValue([makeEntry()])
    __setWillCallDeps({ db })

    const res = await searchGet(
      getReq('http://localhost/api/events/event-1/will-call?q=novak&status=ready_for_pickup'),
      { params: Promise.resolve({ eventId: 'event-1' }) },
    )

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(Array.isArray(json.entries)).toBe(true)
    expect(json.total).toBe(1)
  })

  it('returns 400 for invalid status value', async () => {
    __setWillCallDeps({ db: makeDb(null) })

    const res = await searchGet(
      getReq('http://localhost/api/events/event-1/will-call?status=invalid_status'),
      { params: Promise.resolve({ eventId: 'event-1' }) },
    )

    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toContain('Invalid status')
  })
})
