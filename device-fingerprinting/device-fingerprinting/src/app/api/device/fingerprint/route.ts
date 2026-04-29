import { NextRequest, NextResponse } from 'next/server';
import { z, ZodError } from 'zod';
import { assessDevice } from '../../../../services/device.service.js';
import { isDeviceError } from '../../../../lib/device-errors.js';
import type { DeviceDeps } from '../../../../services/device.service.js';

const FingerprintSchema = z.object({
  ipAddress:            z.string().min(1),
  userAgent:            z.string().optional(),
  acceptLanguage:       z.string().optional(),
  screenResolution:     z.string().optional(),
  timezone:             z.string().optional(),
  platform:             z.string().optional(),
  colorDepth:           z.number().int().optional(),
  hardwareConcurrency:  z.number().int().optional(),
  userId:               z.string().uuid().optional(),
  eventId:              z.string().uuid().optional(),
  orderId:              z.string().uuid().optional(),
  action:               z.string().optional(),
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

  let input: z.infer<typeof FingerprintSchema>;
  try { input = FingerprintSchema.parse(body); } catch (err) {
    if (err instanceof ZodError) return NextResponse.json({ error: 'VALIDATION_ERROR', details: err.errors }, { status: 400 });
    throw err;
  }

  try {
    const { userId, eventId, orderId, action, ...signalFields } = input;
    const assessment = await assessDevice(
      { signals: signalFields, userId, eventId, orderId, action },
      resolvedDeps,
    );
    const status = assessment.allowed ? 200 : 429;
    return NextResponse.json(assessment, { status });
  } catch (err) {
    if (isDeviceError(err)) return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    throw err;
  }
}

function getProductionDeps(): DeviceDeps {
  throw new Error('Production dependencies not configured.');
}
