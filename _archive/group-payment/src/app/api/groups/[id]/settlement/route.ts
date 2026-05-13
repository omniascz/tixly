import { NextRequest, NextResponse } from 'next/server';
import { settlementReport, getGroupPaymentStatus } from '../../../../../services/group-payment.service';

const deps = {
  db: null as any,
};

// GET /api/groups/[id]/settlement — get settlement report
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const userId = request.headers.get('x-user-id');
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    // Verify authorization
    const group = await getGroupPaymentStatus(deps.db, params.id);
    const isMember = group.members.some((m) => m.userId === userId);
    if (group.groupOwnerId !== userId && !isMember) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Generate settlement report
    const report = await settlementReport(deps.db, params.id);

    return NextResponse.json(report, { status: 200 });
  } catch (err: any) {
    if (err.name === 'GroupPaymentNotFoundError') {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    console.error('Error getting settlement report:', err);
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
