import { NextRequest, NextResponse } from 'next/server';
import { getServiceDeps } from '../../../../../../lib/service-container.js';
import { errorResponse } from '../../../../../../lib/route-helpers.js';
import { expireOldPackages } from '../../../../../../services/permanentky.service.js';

export async function POST(req: NextRequest) {
  try {
    if (req.headers.get('x-is-admin') !== 'true') {
      return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
    }
    const result = await expireOldPackages(getServiceDeps());
    return NextResponse.json(result);
  } catch (err) {
    return errorResponse(err);
  }
}
