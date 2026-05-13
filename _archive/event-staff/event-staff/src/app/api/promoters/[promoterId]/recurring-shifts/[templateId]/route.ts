import { NextRequest, NextResponse } from 'next/server';
import { getServiceDeps } from '../../../../../../lib/service-container.js';
import { deactivateTemplate } from '../../../../../../services/recurring-shifts.service.js';
import { isStaffError } from '../../../../../../lib/staff-errors.js';

export async function DELETE(
  req: NextRequest,
  { params }: { params: { promoterId: string; templateId: string } },
): Promise<NextResponse> {
  const userId = req.headers.get('x-user-id');
  if (!userId) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  try {
    const deps = getServiceDeps();
    await deactivateTemplate(params.templateId, params.promoterId, deps);
    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err) {
    if (isStaffError(err)) {
      return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    }
    throw err;
  }
}
