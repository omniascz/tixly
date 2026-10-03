import { NextResponse } from 'next/server';

/**
 * FIX K1 — „demo/mock" cesty, které vystaví placenou hodnotu (lístek, upgrade,
 * voucher, předplatné) BEZ reálné platby:
 *   - POST /api/buyer/resale/buy                       (mock resale transfer)
 *   - POST /api/buyer/tickets/[id]/upgrade             (mock upgrade bez doplatku)
 *   - POST /api/vouchers/holders/[paymentId]/confirm   (mock voucher payment confirm)
 *   - POST /api/subscriptions/holders/[paymentId]/confirm (mock subscription confirm)
 *
 * Napojení na skutečný platební tok (create payment → webhook → paid → issue)
 * je u každé z nich větší přepis (viz FIX_REPORT_K.md, K1). Do té doby jsou
 * VYPNUTÉ VE VÝCHOZÍM STAVU a vrací 404 — přesně dle zadání pro cesty, které
 * nelze bez velkého přepisu hned napojit.
 *
 * Zapnout jde jen VÝSLOVNĚ a jen mimo produkci (řízené staging demo):
 *   ENABLE_DEMO_PAYMENT_PATHS=1  a zároveň  NODE_ENV !== 'production'
 * V produkci jsou vypnuté vždy, bez ohledu na flag.
 */
export function demoPaymentPathsEnabled(): boolean {
  if (process.env.NODE_ENV === 'production') return false;
  return process.env.ENABLE_DEMO_PAYMENT_PATHS === '1';
}

/** Vrátí 404 Response když je demo cesta vypnutá (výchozí stav), jinak null. */
export function demoPathDisabledResponse(): NextResponse | null {
  if (demoPaymentPathsEnabled()) return null;
  return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
}
