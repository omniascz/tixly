// GET /api/fraud-detection/runs/:subjectType/:subjectId — recent runs for a subject
import { getServiceDeps } from '../../../../../../lib/service-container.js';

const ALLOWED = new Set(['order', 'user', 'device']);

export async function GET(
  req: Request,
  ctx: { params: { subjectType: string; subjectId: string } },
): Promise<Response> {
  const auth = req.headers.get('x-internal-auth');
  if (!auth || auth !== process.env.INTERNAL_AUTH_TOKEN) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });
  }

  const { subjectType, subjectId } = ctx.params;
  if (!ALLOWED.has(subjectType)) {
    return new Response(JSON.stringify({ error: 'invalid_subject_type' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  const deps = getServiceDeps();
  const rows = await deps.db.query<{
    id: string;
    subject_type: string;
    subject_id: string;
    total_score: number;
    recommendation: string;
    signals: unknown;
    ran_at: string;
  }>(
    `SELECT id, subject_type, subject_id, total_score, recommendation, signals, ran_at
     FROM risk.detection_runs
     WHERE subject_type = $1 AND subject_id = $2
     ORDER BY ran_at DESC
     LIMIT 50`,
    [subjectType, subjectId],
  );

  return new Response(JSON.stringify({ runs: rows }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}
