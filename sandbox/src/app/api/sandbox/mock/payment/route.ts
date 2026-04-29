import { NextRequest, NextResponse } from 'next/server';
import { processMockPayment } from '../../../../../services/mock-services.service.js';
import { isSandboxError } from '../../../../../lib/sandbox-errors.js';

export async function POST(req: NextRequest) {
  try {
    const input = await req.json();
    return NextResponse.json(processMockPayment(input), { status: 201 });
  } catch (err) {
    if (isSandboxError(err)) return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    throw err;
  }
}
