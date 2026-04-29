import { NextRequest, NextResponse } from 'next/server';
import { listLeads } from '../../../../../services/lead.service.js';
import { getServiceDeps } from '../../../../../lib/service-container.js';
import type { LeadStatus, LeadPriority } from '../../../../../types/lead.js';

export async function GET(
  req: NextRequest,
  { params }: { params: { promoterId: string } },
) {
  try {
    const { searchParams } = new URL(req.url);
    const status = (searchParams.get('status') as LeadStatus | null) ?? undefined;
    const priority = (searchParams.get('priority') as LeadPriority | null) ?? undefined;
    const tagsParam = searchParams.get('tags');
    const tags = tagsParam ? tagsParam.split(',').filter(Boolean) : undefined;
    const search = searchParams.get('search') ?? undefined;
    const fromParam = searchParams.get('from');
    const toParam = searchParams.get('to');
    const from = fromParam ? new Date(fromParam) : undefined;
    const to = toParam ? new Date(toParam) : undefined;
    const limit = parseInt(searchParams.get('limit') ?? '50', 10);
    const offset = parseInt(searchParams.get('offset') ?? '0', 10);

    const deps = getServiceDeps();
    const result = await listLeads(
      params.promoterId,
      { status, priority, tags, search, from, to },
      { limit, offset },
      deps,
    );
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { success: false, message: 'Interní chyba serveru.' },
      { status: 500 },
    );
  }
}
