// POST /api/platform/admin/cron/sweep-fraud?hours=24
import { sweepRecentOrders } from '../../../../../../services/detection-runner.service.js';
import { getServiceDeps } from '../../../../../../lib/service-container.js';
import { DEFAULT_DETECTOR_CONFIG } from '../../../../../../types/detection.js';

export async function POST(req: Request): Promise<Response> {
  const auth = req.headers.get('x-internal-auth');
  if (!auth || auth !== process.env.INTERNAL_AUTH_TOKEN) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });
  }

  const url = new URL(req.url);
  const hoursParam = url.searchParams.get('hours');
  const hours = hoursParam ? parseInt(hoursParam, 10) : 24;
  if (!Number.isFinite(hours) || hours <= 0 || hours > 168) {
    return new Response(JSON.stringify({ error: 'invalid_hours' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  const deps = getServiceDeps();
  const result = await sweepRecentOrders(hours, DEFAULT_DETECTOR_CONFIG, deps);
  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}
