import { NextRequest, NextResponse } from 'next/server'
import { verifyResellerPassword, signResellerToken } from '@/lib/reseller-auth'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest): Promise<Response> {
  let body: { email?: string; password?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const { email, password } = body
  if (!email || !password) {
    return NextResponse.json({ error: 'email and password required' }, { status: 400 })
  }
  const session = await verifyResellerPassword(email, password)
  if (!session) {
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
  }
  return NextResponse.json({ token: await signResellerToken(session), partnerName: session.partnerName })
}
