/**
 * OrderError — strukturované chybové typy pro order-service.
 *
 * Každý kód odpovídá konkrétnímu bodu selhání v createFullOrder.
 * Stavové kódy HTTP jsou podle konvence REST:
 *   404 = zdroj neexistuje
 *   409 = konflikt stavu (inventář, zámek, limit, stav události)
 *   500 = vnitřní chyba serveru
 */

export class OrderError extends Error {
  constructor(
    public readonly code: string,
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'OrderError';
  }

  toHttpError(): { error: { code: string; message: string }; statusCode: number } {
    return {
      error: { code: this.code, message: this.message },
      statusCode: this.statusCode,
    };
  }
}

// ---------------------------------------------------------------------------
// Factory helpers — každý vrací předvyplněný OrderError
// ---------------------------------------------------------------------------

export const OrderErrors = {
  eventNotFound: (eventId: string) =>
    new OrderError('EVENT_NOT_FOUND', 404, `Akce s ID „${eventId}" nebyla nalezena.`),

  eventNotPublished: (eventId: string) =>
    new OrderError('EVENT_NOT_PUBLISHED', 409, `Akce „${eventId}" není zveřejněna a nelze na ni zakoupit vstupenky.`),

  eventInPast: (eventId: string) =>
    new OrderError('EVENT_IN_PAST', 409, `Akce „${eventId}" již proběhla. Prodej vstupenek byl ukončen.`),

  ticketTypeNotFound: (ticketTypeId: string) =>
    new OrderError('TICKET_TYPE_NOT_FOUND', 404, `Typ vstupenky „${ticketTypeId}" nebyl nalezen nebo nepatří k této akci.`),

  insufficientInventory: (ticketTypeId: string, requested: number, available: number) =>
    new OrderError(
      'INSUFFICIENT_INVENTORY',
      409,
      `Nedostatečná kapacita pro typ vstupenky „${ticketTypeId}". Požadováno: ${requested}, dostupné: ${available}.`,
    ),

  seatAlreadyLocked: (seatIds: string[]) =>
    new OrderError(
      'SEAT_ALREADY_LOCKED',
      409,
      `Sedadlo/sedadla jsou již rezervována jinou objednávkou: ${seatIds.join(', ')}.`,
    ),

  purchaseLimitExceeded: (message: string) =>
    new OrderError('PURCHASE_LIMIT_EXCEEDED', 409, message),

  paymentProviderNotConfigured: () =>
    new OrderError(
      'PAYMENT_PROVIDER_NOT_CONFIGURED',
      500,
      'Platební brána není nakonfigurována. Kontaktujte správce systému.',
    ),

  orderCreationFailed: (cause: string) =>
    new OrderError('ORDER_CREATION_FAILED', 500, `Vytvoření objednávky selhalo: ${cause}`),
} as const;
