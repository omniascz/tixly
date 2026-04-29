import { NextRequest, NextResponse } from 'next/server';
import { sendMockEmail, getMockInbox, clearMockInbox } from '../../../../../services/mock-services.service.js';
import { isSandboxError } from '../../../../../lib/sandbox-errors.js';

export async function GET(req: NextRequest) {
  const email = req.nextUrl.searchParams.get('email');
  if (!email) return NextResponse.json({ error: 'email required' }, { status: 400 });
  return NextResponse.json({ inbox: getMockInbox(email) });
}

export async function POST(req: NextRequest) {
  try {
    const input = await req.json();
    return NextResponse.json(sendMockEmail(input), { status: 201 });
  } catch (err) {
    if (isSandboxError(err)) return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    throw err;
  }
}

export async function DELETE(req: NextRequest) {
  const email = req.nextUrl.searchParams.get('email') ?? undefined;
  clearMockInbox(email);
  return NextResponse.json({ cleared: true });
}
