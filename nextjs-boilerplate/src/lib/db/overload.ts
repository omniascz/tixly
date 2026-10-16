/**
 * Kolo 14 / krok 2 — řízené přetížení nákupní cesty (nápor při spuštění prodeje).
 *
 * Když aplikaci dojdou spojení do DB — fronta pg poolu čeká déle než connectionTimeoutMillis („timeout exceeded when
 * trying to connect"), nebo PgBouncer / DB nepřijme nové spojení včas („Connection terminated due to connection
 * timeout") — nejde o chybu aplikace, ale o dočasné přetížení. Odpověď je 503 + Retry-After (prohlížeč, embed widget
 * i GoPay webhook to zopakují), ne 500. Jiné chyby se NEmaskují — propadnou dál beze změny.
 */
import { NextResponse } from 'next/server';

const OVERLOAD_MESSAGES = [
  'timeout exceeded when trying to connect',
  'Connection terminated due to connection timeout',
];

export const BUSY_RETRY_AFTER_S = 2;

export function isDbOverloaded(err: unknown): boolean {
  for (let e: unknown = err, depth = 0; e && depth < 3; e = (e as { cause?: unknown }).cause, depth++) {
    const msg = (e as { message?: unknown }).message;
    if (typeof msg === 'string' && OVERLOAD_MESSAGES.some((m) => msg.includes(m))) return true;
  }
  return false;
}

export function busyResponse(): Response {
  return NextResponse.json(
    { error: 'BUSY', message: 'Velký zájem — zkuste to prosím za chvíli znovu.' },
    { status: 503, headers: { 'Retry-After': String(BUSY_RETRY_AFTER_S), 'Cache-Control': 'no-store' } },
  );
}

/** Obalí handler: přetížení DB → 503 Retry-After; ostatní chyby propadnou beze změny. */
export async function withDbOverload(handler: () => Promise<Response>): Promise<Response> {
  try {
    return await handler();
  } catch (err) {
    if (isDbOverloaded(err)) {
      console.warn('[overload] DB pool vyčerpán → 503 Retry-After');
      return busyResponse();
    }
    throw err;
  }
}
