/**
 * Politika QR při odbavení — jedno místo pro všechny skenovací routy (validate, passage).
 *
 * Kolo 5: režim „průchod" (passage) si politiku nepočítal a pustil holé UUID vstupenky i tam,
 * kde validate vyžaduje rotující QR. Rozhodnutí proto žije tady a obě routy ho sdílejí.
 *
 *   static_allowed  → TOTP volitelný (offline/static QR funguje vždy)
 *   rotating_24h    → TOTP volitelný DO 24 h před akcí, pak POVINNÝ (kolo 2: výchozí)
 *   rotating_only   → TOTP POVINNÝ vždy (jen mobilní QR)
 *   photo_required  → TOTP POVINNÝ + fotokontrola u brány
 *
 * Tištěná vstupenka s podepsaným TXP2 (vázaným na akci, kolo 4) TOTP mít nemůže; u static_allowed
 * a rotating_24h ho nahrazuje, u rotating_only / photo_required ne.
 */
export interface QrPolicyInput {
  qrPolicy: string | null | undefined;
  eventDateStart: string | Date | null | undefined;
  /** Platný TXP2 token ověřený proti akci vstupenky. */
  printVerifiedForEvent: boolean;
  now?: number;
}

export type QrPolicyDecision = { totpRequired: false } | { totpRequired: true; qrPolicy: string; message: string };

const DAY_MS = 24 * 60 * 60 * 1000;

export function qrPolicyDecision(input: QrPolicyInput): QrPolicyDecision {
  const qrPolicy = input.qrPolicy ?? 'rotating_24h';
  let required = qrPolicy === 'rotating_only' || qrPolicy === 'photo_required';
  if (qrPolicy === 'rotating_24h' && input.eventDateStart) {
    const eventMs = new Date(input.eventDateStart).getTime();
    if (eventMs - (input.now ?? Date.now()) <= DAY_MS) required = true;
  }
  if (input.printVerifiedForEvent && (qrPolicy === 'static_allowed' || qrPolicy === 'rotating_24h')) {
    required = false;
  }
  if (!required) return { totpRequired: false };
  const message =
    qrPolicy === 'photo_required'
      ? 'Tento lístek vyžaduje rotující QR + fotokontrolu u brány. Použij mobilní vstupenku.'
      : qrPolicy === 'rotating_24h'
        ? 'Tato akce vyžaduje rotující QR od 24h před začátkem. PDF nestačí, použij mobilní vstupenku.'
        : 'Tato akce vyžaduje rotující QR. Použij mobilní vstupenku, ne PDF.';
  return { totpRequired: true, qrPolicy, message };
}
