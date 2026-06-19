import { NextRequest, NextResponse } from 'next/server'
import { runAsPlatformAdmin } from '@/lib/platform-auth'
import { db } from '@/lib/db/rls-pool'
import bcrypt from 'bcryptjs'

export const dynamic = 'force-dynamic'

interface PartnerRow {
  id: string
  name: string
  contact_email: string
  contact_phone: string | null
  address: string | null
  city: string | null
  commission_pct: number
  status: string
  notes: string | null
  last_login_at: string | null
  created_at: string
  total_sales: string
  total_commission: string
}

export async function GET(req: NextRequest): Promise<Response> {
  return runAsPlatformAdmin(req, async () => {
    const r = await db().query<PartnerRow>(
      `SELECT rp.id, rp.name, rp.contact_email, rp.contact_phone,
              rp.address, rp.city, rp.commission_pct, rp.status, rp.notes,
              rp.last_login_at, rp.created_at,
              COUNT(rs.id) AS total_sales,
              COALESCE(SUM(rs.commission_amount_halire), 0) AS total_commission
       FROM platform.reseller_partners rp
       LEFT JOIN orders.reseller_sales rs ON rs.partner_id = rp.id
       GROUP BY rp.id
       ORDER BY rp.created_at DESC`,
    )
    return NextResponse.json({ partners: r.rows })
  })
}

export async function POST(req: NextRequest): Promise<Response> {
  let body: {
    name?: string
    contactEmail?: string
    contactPhone?: string
    address?: string
    city?: string
    commissionPct?: number
    password?: string
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { name, contactEmail, contactPhone, address, city, commissionPct = 5, password } = body
  if (!name || !contactEmail || !password) {
    return NextResponse.json({ error: 'name, contactEmail, password required' }, { status: 400 })
  }

  const passwordHash = await bcrypt.hash(password, 12)

  return runAsPlatformAdmin(req, async () => {
    const r = await db().query<{ id: string; name: string; contact_email: string; commission_pct: number; status: string; created_at: string }>(
      `INSERT INTO platform.reseller_partners
         (name, contact_email, contact_phone, address, city, commission_pct, password_hash, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')
       RETURNING id, name, contact_email, commission_pct, status, created_at`,
      [name, contactEmail, contactPhone ?? null, address ?? null, city ?? null, commissionPct, passwordHash],
    )
    return NextResponse.json({ partner: r.rows[0] }, { status: 201 })
  })
}

export async function PATCH(req: NextRequest): Promise<Response> {
  let body: { id?: string; status?: string; commissionPct?: number; notes?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { id, status, commissionPct, notes } = body
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const setClauses: string[] = ['updated_at = NOW()']
  const values: unknown[] = [id]

  if (status !== undefined) {
    if (!['pending', 'active', 'suspended'].includes(status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
    }
    values.push(status)
    setClauses.push(`status = $${values.length}`)
  }
  if (commissionPct !== undefined) {
    values.push(commissionPct)
    setClauses.push(`commission_pct = $${values.length}`)
  }
  if (notes !== undefined) {
    values.push(notes)
    setClauses.push(`notes = $${values.length}`)
  }

  return runAsPlatformAdmin(req, async () => {
    const r = await db().query(
      `UPDATE platform.reseller_partners
       SET ${setClauses.join(', ')}
       WHERE id = $1
       RETURNING id, name, status, commission_pct, notes`,
      values,
    )
    if (!r.rows[0]) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ partner: r.rows[0] })
  })
}
