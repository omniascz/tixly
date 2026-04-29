import { NextResponse } from 'next/server';
import { getSmsHistory } from '../../../../services/sms.service.js';
import { getServiceDeps } from '../../../../lib/service-container.js';
import type { SmsCategory, SmsStatus } from '../../../../types/sms.js';

export async function GET(req: Request): Promise<Response> {
  const userId = req.headers.get('x-user-id');
  const role = req.headers.get('x-user-role');
  if (!userId || (role !== 'admin' && role !== 'promoter')) {
    return NextResponse.json(
      { error: 'FORBIDDEN', message: 'Nemáte oprávnění k historii SMS.' },
      { status: 403 },
    );
  }

  const url = new URL(req.url);
  const promoterId = url.searchParams.get('promoterId');
  if (!promoterId) {
    return NextResponse.json(
      { error: 'VALIDATION_ERROR', message: 'Chybí promoterId.' },
      { status: 400 },
    );
  }

  const category = url.searchParams.get('category') as SmsCategory | null;
  const status = url.searchParams.get('status') as SmsStatus | null;
  const fromRaw = url.searchParams.get('from');
  const toRaw = url.searchParams.get('to');
  const limit = parseInt(url.searchParams.get('limit') ?? '50', 10);
  const offset = parseInt(url.searchParams.get('offset') ?? '0', 10);

  const result = await getSmsHistory(
    promoterId,
    {
      category: category ?? undefined,
      status: status ?? undefined,
      from: fromRaw ? new Date(fromRaw) : undefined,
      to: toRaw ? new Date(toRaw) : undefined,
    },
    { limit, offset },
    getServiceDeps(),
  );

  return NextResponse.json(result);
}
