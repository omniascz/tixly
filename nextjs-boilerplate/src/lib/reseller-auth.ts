import { SignJWT, jwtVerify } from 'jose'
import bcrypt from 'bcryptjs'
import { db } from '@/lib/db/rls-pool'

export interface ResellerSession { partnerId: string; partnerName: string; commissionPct: number }

function getResellerSecret(): Uint8Array {
  const secret = process.env.RESELLER_JWT_SECRET ?? process.env.JWT_SECRET ?? 'reseller-dev-secret'
  return new TextEncoder().encode(secret)
}

export async function verifyResellerPassword(email: string, password: string): Promise<ResellerSession | null> {
  const r = await db().query<{ id: string; name: string; password_hash: string; commission_pct: number; status: string }>(
    'SELECT id, name, password_hash, commission_pct, status FROM platform.reseller_partners WHERE contact_email=$1',
    [email],
  )
  if (!r.rows[0] || r.rows[0].status !== 'active') return null
  const ok = await bcrypt.compare(password, r.rows[0].password_hash)
  if (!ok) return null
  await db().query('UPDATE platform.reseller_partners SET last_login_at=NOW() WHERE id=$1', [r.rows[0].id])
  return { partnerId: r.rows[0].id, partnerName: r.rows[0].name, commissionPct: r.rows[0].commission_pct }
}

// Kolo 3: typ tokenu prodejce. Bez RESELLER_JWT_SECRET sdílí klíč s přihlášením kupců —
// verifyResellerToken proto bral jakýkoli JWT téhož klíče (i přístupový token kupce) jako relaci.
const RESELLER_TOKEN_TYPE = 'reseller'

export async function signResellerToken(session: ResellerSession): Promise<string> {
  return new SignJWT({ ...session, type: RESELLER_TOKEN_TYPE })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('8h')
    .sign(getResellerSecret())
}

export async function verifyResellerToken(token: string): Promise<ResellerSession | null> {
  try {
    const { payload } = await jwtVerify(token, getResellerSecret())
    const p = payload as unknown as Partial<ResellerSession> & { type?: unknown }
    if (p.type !== RESELLER_TOKEN_TYPE || typeof p.partnerId !== 'string' || !p.partnerId) return null
    return { partnerId: p.partnerId, partnerName: String(p.partnerName ?? ''), commissionPct: Number(p.commissionPct ?? 0) }
  } catch { return null }
}

export async function requireReseller(req: Request): Promise<ResellerSession> {
  const auth = req.headers.get('authorization') ?? ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  const session = await verifyResellerToken(token)
  if (!session) throw new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
  return session
}
