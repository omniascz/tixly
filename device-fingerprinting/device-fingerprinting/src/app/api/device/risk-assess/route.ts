import { NextRequest, NextResponse } from 'next/server';
import { z, ZodError } from 'zod';
import { assessRisk } from '../../../../services/device.service.js';
import { isDeviceError } from '../../../../lib/device-errors.js';
import type { DeviceDeps } from '../../../../services/device.service.js';

const BehaviorSignalsSchema = z.object({
  mouseMovements:       z.number().int().nonnegative(),
  mouseVarianceX:       z.number().nonnegative(),
  mouseVarianceY:       z.number().nonnegative(),
  clickCount:           z.number().int().nonnegative(),
  avgClickIntervalMs:   z.number().nonnegative(),
  clickIntervalStddev:  z.number().nonnegative(),
  keyPressCount:        z.number().int().nonnegative(),
  timeOnPageMs:         z.number().nonnegative(),
  focusBlurCount:       z.number().int().nonnegative(),
  hasTouchEvents:       z.boolean(),
});

const RiskAssessSchema = z.object({
  fingerprintHash: z.string().min(32),
  behaviorSignals: BehaviorSignalsSchema,
});

export async function POST(
  request: NextRequest,
  { deps }: { deps?: DeviceDeps } = {},
): Promise<NextResponse> {
  const resolvedDeps = deps ?? getProductionDeps();

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 });
  }

  let input: z.infer<typeof RiskAssessSchema>;
  try { input = RiskAssessSchema.parse(body); } catch (err) {
    if (err instanceof ZodError) return NextResponse.json({ error: 'VALIDATION_ERROR', details: err.errors }, { status: 400 });
    throw err;
  }

  try {
    const assessment = await assessRisk(input.fingerprintHash, input.behaviorSignals, resolvedDeps);
    const status = assessment.recommendation === 'block' ? 403 : 200;
    return NextResponse.json(assessment, { status });
  } catch (err) {
    if (isDeviceError(err)) return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    throw err;
  }
}

function getProductionDeps(): DeviceDeps {
  throw new Error('Production dependencies not configured.');
}
