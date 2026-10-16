/**
 * POST /api/ops/sentry-check — kolo 14 / krok 3: kontrola napojení Sentry po nasazení (Bearer CRON_SECRET).
 *
 * Vyhodí neošetřenou chybu, jejíž text i kontext obsahují ukázkové osobní údaje kupce. V Sentry se má objevit chyba
 * „Sentry kontrola …" s maskovanými údaji ([email], [telefon], [skryto]) — tím se ověří zachytávání chyb z route
 * handlerů i maskování. Bez tajemství 403; nic nemění v datech.
 */
import { NextRequest, NextResponse } from 'next/server';
import { isCronAuthorized } from '@/lib/security/cron-auth';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest): Promise<Response> {
  if (!isCronAuthorized(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const err = new Error('Sentry kontrola: kupec jana.novakova@example.cz, tel. +420 777 123 456');
  (err as Error & { buyer?: unknown }).buyer = { buyerName: 'Jana Nováková', buyerEmail: 'jana.novakova@example.cz' };
  throw err;
}
