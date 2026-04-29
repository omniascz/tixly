import { NextRequest, NextResponse } from 'next/server';
import { z, ZodError } from 'zod';
import { enqueueFraudCase } from '../../../../../../services/fraud-queue.service';
import { isFraudError } from '../../../../../../lib/fraud-errors';
import type { FraudDeps } from '../../../../../../services/fraud-queue.service';

// ---------------------------------------------------------------------------
// POST /api/platform/admin/fraud/ingest
//
// Interní endpoint — volaný z checkout pipeline nebo Kafka consumera
// pro přidání podezřelé objednávky do fraud fronty.
//
// Chráněno service-to-service tokenom (x-internal-token header),
// nikoliv admin user ID.
//
// Request body:
// {
//   "orderId": "uuid",
//   "userId": "uuid",
//   "promoterId": "uuid",        // optional
//   "eventId": "uuid",           // optional
//   "amountHellers": 150000,
//   "currency": "CZK",
//   "riskScore": 75,
//   "signals": [
//     { "rule": "velocity_check", "detail": "4 orders in 8min from IP 1.2.3.4", "score": 35 },
//     { "rule": "geo_mismatch",   "detail": "billing=CZ, ip=CN",                "score": 20 }
//   ],
//   "ipAddress": "1.2.3.4",
//   "countryCode": "CN",
//   "orderHeld": true
// }
//
// Response (201): { "caseId": "uuid" }
// ---------------------------------------------------------------------------

const SignalSchema = z.object({
  rule:   z.string().min(1).max(100),
  detail: z.string().max(500),
  score:  z.number().int().min(0).max(100),
});

const IngestSchema = z.object({
  orderId:       z.string().uuid(),
  userId:        z.string().uuid(),
  promoterId:    z.string().uuid().optional(),
  eventId:       z.string().uuid().optional(),
  amountHellers: z.number().int().min(0),
  currency:      z.string().length(3).optional(),
  riskScore:     z.number().int().min(0).max(100),
  signals:       z.array(SignalSchema).min(1),
  ipAddress:     z.string().max(45).optional(),
  userAgent:     z.string().max(500).optional(),
  countryCode:   z.string().length(2).optional(),
  orderHeld:     z.boolean().optional(),
  sourceModule:  z.enum(['device-fingerprinting', 'bank-reconciliation', 'gopay-payments', 'checkout', 'manual']).optional(),
  sourceRefId:   z.string().max(200).optional(),
});

const INGEST_TOKEN_HEADER = 'x-internal-token';

export async function POST(
  request: NextRequest,
  context?: { deps?: FraudDeps },
): Promise<NextResponse> {
  const deps = context?.deps ?? getProductionDeps();

  // Service-to-service autentizace
  const internalToken = request.headers.get(INGEST_TOKEN_HEADER);
  const expectedToken = process.env.INTERNAL_SERVICE_TOKEN;
  if (!expectedToken || internalToken !== expectedToken) {
    return NextResponse.json(
      { error: 'UNAUTHORIZED', message: 'Invalid internal service token' },
      { status: 401 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'INVALID_JSON', message: 'Invalid request body' },
      { status: 400 },
    );
  }

  let input: z.infer<typeof IngestSchema>;
  try {
    input = IngestSchema.parse(body);
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json(
        { error: 'VALIDATION_ERROR', message: 'Invalid input', details: err.errors },
        { status: 400 },
      );
    }
    throw err;
  }

  try {
    const result = await enqueueFraudCase(input, deps);
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    if (isFraudError(err)) {
      return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    }
    throw err;
  }
}

function getProductionDeps(): FraudDeps {
  throw new Error('Production dependencies not configured. Use dependency injection.');
}
