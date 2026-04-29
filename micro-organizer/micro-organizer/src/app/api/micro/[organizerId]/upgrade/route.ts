import { NextRequest, NextResponse } from 'next/server';
import { requestUpgrade } from '../../../../../services/micro-organizer.service.js';
import { isMicroOrganizerError } from '../../../../../lib/micro-organizer-errors.js';
import { getServiceDeps } from '../../../../../lib/service-container.js';
import type { ServiceDeps } from '../../../../../lib/service-container.js';

// ---------------------------------------------------------------------------
// POST /api/micro/[organizerId]/upgrade — žádost o upgrade na plného promotéra
// Emituje Kafka event `micro_organizer.upgrade_requested`.
// Samotný upgrade (přidání IČO + IBAN) je mimo scope tohoto modulu.
// ---------------------------------------------------------------------------
export async function POST(
  _request: NextRequest,
  context: { params: { organizerId: string }; deps?: ServiceDeps },
): Promise<NextResponse> {
  const deps: ServiceDeps = context?.deps ?? getServiceDeps();
  const { organizerId } = context.params;

  try {
    await requestUpgrade(organizerId, deps);
    return NextResponse.json(
      {
        message:
          'Vaše žádost o upgrade byla přijata. Budeme vás kontaktovat s dalšími kroky (IČO, IBAN).',
      },
      { status: 200 },
    );
  } catch (err) {
    if (isMicroOrganizerError(err)) {
      return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    }
    throw err;
  }
}
