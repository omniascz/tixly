// POST /api/fraud-detection/run — internal service endpoint
import { z } from 'zod';
import { runDetection } from '../../../../services/detection-runner.service.js';
import { getServiceDeps } from '../../../../lib/service-container.js';
import { AiFraudError } from '../../../../lib/fraud-errors.js';
import { DEFAULT_DETECTOR_CONFIG } from '../../../../types/detection.js';

const BodySchema = z.object({
  subjectType: z.enum(['order', 'user', 'device']),
  subjectId: z.string().min(1),
});

function unauthorized(): Response {
  return new Response(JSON.stringify({ error: 'unauthorized' }), {
    status: 401,
    headers: { 'content-type': 'application/json' },
  });
}

export async function POST(req: Request): Promise<Response> {
  const auth = req.headers.get('x-internal-auth');
  if (!auth || auth !== process.env.INTERNAL_AUTH_TOKEN) {
    return unauthorized();
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'invalid_json' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return new Response(
      JSON.stringify({ error: 'invalid_body', issues: parsed.error.issues }),
      { status: 400, headers: { 'content-type': 'application/json' } },
    );
  }

  try {
    const deps = getServiceDeps();
    const report = await runDetection(
      parsed.data.subjectType,
      parsed.data.subjectId,
      DEFAULT_DETECTOR_CONFIG,
      deps,
    );
    return new Response(JSON.stringify(report), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  } catch (err) {
    if (err instanceof AiFraudError) {
      return new Response(JSON.stringify({ error: err.code, message: err.message }), {
        status: err.status,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ error: 'DETECTION_FAILED' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }
}
