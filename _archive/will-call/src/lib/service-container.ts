// Service container — wires WillCallDbAdapter to a Postgres Pool.
//
// Required schema (platform.will_call_entries):
//   id UUID PRIMARY KEY
//   ticket_id TEXT NOT NULL
//   order_id TEXT NOT NULL
//   event_id TEXT NOT NULL
//   holder_name TEXT NOT NULL
//   holder_email TEXT NOT NULL
//   holder_phone TEXT
//   ticket_type_name TEXT NOT NULL
//   quantity INT NOT NULL DEFAULT 1
//   status TEXT NOT NULL  -- reserved | ready_for_pickup | picked_up | forfeited
//   pickup_location TEXT
//   pickup_window_start TIMESTAMPTZ
//   pickup_window_end TIMESTAMPTZ
//   notes TEXT
//   picked_up_at TIMESTAMPTZ
//   picked_up_by_staff_id TEXT
//   forfeited_at TIMESTAMPTZ
//   pickup_printed_at TIMESTAMPTZ
//   pickup_printed_by TEXT
//   sms_sent_at TIMESTAMPTZ
//   created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()

import { Pool, PoolClient } from 'pg'
import type {
  WillCallEntry,
  WillCallStatus,
} from '../types/will-call.types.js'
import type { WillCallDbAdapter } from '../services/will-call.service.js'

export interface ServiceDeps {
  db: WillCallDbAdapter
}

declare global {
  // eslint-disable-next-line no-var
  var _willCallDeps: ServiceDeps | undefined
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Queryable = { query: (sql: string, params?: any[]) => Promise<any> }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapRow(row: any): WillCallEntry {
  return {
    id: row.id,
    ticket_id: row.ticket_id,
    order_id: row.order_id,
    event_id: row.event_id,
    holder_name: row.holder_name,
    holder_email: row.holder_email,
    holder_phone: row.holder_phone ?? null,
    ticket_type_name: row.ticket_type_name,
    quantity: Number(row.quantity),
    status: row.status as WillCallStatus,
    pickup_location: row.pickup_location ?? null,
    pickup_window_start: row.pickup_window_start ? new Date(row.pickup_window_start) : null,
    pickup_window_end: row.pickup_window_end ? new Date(row.pickup_window_end) : null,
    notes: row.notes ?? null,
    picked_up_at: row.picked_up_at ? new Date(row.picked_up_at) : null,
    picked_up_by_staff_id: row.picked_up_by_staff_id ?? null,
    forfeited_at: row.forfeited_at ? new Date(row.forfeited_at) : null,
    created_at: new Date(row.created_at),
    pickup_printed_at: row.pickup_printed_at ? new Date(row.pickup_printed_at) : null,
    pickup_printed_by: row.pickup_printed_by ?? null,
    sms_sent_at: row.sms_sent_at ? new Date(row.sms_sent_at) : null,
  }
}

const SELECT_COLS = `
  id, ticket_id, order_id, event_id, holder_name, holder_email, holder_phone,
  ticket_type_name, quantity, status, pickup_location, pickup_window_start,
  pickup_window_end, notes, picked_up_at, picked_up_by_staff_id, forfeited_at,
  pickup_printed_at, pickup_printed_by, sms_sent_at, created_at
`

class PgDbAdapter implements WillCallDbAdapter {
  constructor(private q: Queryable) {}

  async findEntryByTicketId(ticketId: string): Promise<WillCallEntry | null> {
    const res = await this.q.query(
      `SELECT ${SELECT_COLS} FROM platform.will_call_entries WHERE ticket_id = $1 LIMIT 1`,
      [ticketId],
    )
    return res.rows[0] ? mapRow(res.rows[0]) : null
  }

  async findEntryById(id: string): Promise<WillCallEntry | null> {
    const res = await this.q.query(
      `SELECT ${SELECT_COLS} FROM platform.will_call_entries WHERE id = $1 LIMIT 1`,
      [id],
    )
    return res.rows[0] ? mapRow(res.rows[0]) : null
  }

  async searchEntries(
    eventId: string,
    query: string,
    status?: WillCallStatus,
  ): Promise<WillCallEntry[]> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const params: any[] = [eventId]
    let sql = `SELECT ${SELECT_COLS} FROM platform.will_call_entries WHERE event_id = $1`
    if (status) {
      params.push(status)
      sql += ` AND status = $${params.length}`
    }
    if (query && query.length > 0) {
      params.push(`%${query}%`)
      const p = `$${params.length}`
      sql += ` AND (LOWER(holder_name) LIKE ${p} OR LOWER(holder_email) LIKE ${p})`
    }
    sql += ` ORDER BY created_at DESC`
    const res = await this.q.query(sql, params)
    return res.rows.map(mapRow)
  }

  async createEntry(
    data: Omit<WillCallEntry, 'id' | 'created_at'>,
  ): Promise<WillCallEntry> {
    const res = await this.q.query(
      `INSERT INTO platform.will_call_entries (
        ticket_id, order_id, event_id, holder_name, holder_email, holder_phone,
        ticket_type_name, quantity, status, pickup_location, pickup_window_start,
        pickup_window_end, notes, picked_up_at, picked_up_by_staff_id, forfeited_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
      RETURNING ${SELECT_COLS}`,
      [
        data.ticket_id,
        data.order_id,
        data.event_id,
        data.holder_name,
        data.holder_email,
        data.holder_phone,
        data.ticket_type_name,
        data.quantity,
        data.status,
        data.pickup_location,
        data.pickup_window_start,
        data.pickup_window_end,
        data.notes,
        data.picked_up_at,
        data.picked_up_by_staff_id,
        data.forfeited_at,
      ],
    )
    return mapRow(res.rows[0])
  }

  async updateEntry(
    id: string,
    data: Partial<WillCallEntry>,
  ): Promise<WillCallEntry> {
    const fields: string[] = []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const params: any[] = []
    for (const [k, v] of Object.entries(data)) {
      if (k === 'id' || k === 'created_at') continue
      params.push(v)
      fields.push(`${k} = $${params.length}`)
    }
    if (fields.length === 0) {
      const existing = await this.findEntryById(id)
      if (!existing) throw new Error(`Entry not found: ${id}`)
      return existing
    }
    params.push(id)
    const res = await this.q.query(
      `UPDATE platform.will_call_entries SET ${fields.join(', ')}
       WHERE id = $${params.length} RETURNING ${SELECT_COLS}`,
      params,
    )
    return mapRow(res.rows[0])
  }

  async findReadyForPickup(eventId: string): Promise<WillCallEntry[]> {
    const res = await this.q.query(
      `SELECT ${SELECT_COLS} FROM platform.will_call_entries
       WHERE event_id = $1 AND status = 'ready_for_pickup'
       ORDER BY created_at ASC`,
      [eventId],
    )
    return res.rows.map(mapRow)
  }

  async findForfeitableEntries(eventId: string, now: Date): Promise<WillCallEntry[]> {
    const res = await this.q.query(
      `SELECT ${SELECT_COLS} FROM platform.will_call_entries
       WHERE event_id = $1 AND status = 'ready_for_pickup'
         AND pickup_window_end IS NOT NULL AND pickup_window_end < $2`,
      [eventId, now],
    )
    return res.rows.map(mapRow)
  }

  async markBulkStatus(
    ids: string[],
    status: WillCallStatus,
    updatedFields: Partial<WillCallEntry>,
  ): Promise<number> {
    if (ids.length === 0) return 0
    const setClauses: string[] = [`status = $1`]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const params: any[] = [status]
    for (const [k, v] of Object.entries(updatedFields)) {
      if (k === 'id' || k === 'created_at' || k === 'status') continue
      params.push(v)
      setClauses.push(`${k} = $${params.length}`)
    }
    params.push(ids)
    const res = await this.q.query(
      `UPDATE platform.will_call_entries SET ${setClauses.join(', ')}
       WHERE id = ANY($${params.length}::uuid[])`,
      params,
    )
    return res.rowCount ?? 0
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async withTransaction<T>(fn: (tx: any) => Promise<T>): Promise<T> {
    if (!(this.q instanceof Pool)) {
      // Already in a transaction — just pass through
      return fn(this)
    }
    const client: PoolClient = await (this.q as Pool).connect()
    try {
      await client.query('BEGIN')
      const txAdapter = new PgDbAdapter(client)
      const result = await fn(txAdapter)
      await client.query('COMMIT')
      return result
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  }
}

export function getServiceDeps(): ServiceDeps {
  if (!global._willCallDeps) {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL environment variable is not set')
    }
    const pool = new Pool({ connectionString: process.env.DATABASE_URL })
    const db = new PgDbAdapter(pool)
    global._willCallDeps = { db }
  }
  return global._willCallDeps
}

// Exposed for tests that need to inject a mock adapter.
export function __setWillCallDeps(deps: ServiceDeps | undefined): void {
  global._willCallDeps = deps
}
