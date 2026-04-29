export type EventManagementErrorCode =
  | 'EVENT_NOT_FOUND'               // 404
  | 'EVENT_NOT_OWNED'               // 403 — anti-enumerace: vracíme 404
  | 'EVENT_ALREADY_PUBLISHED'       // 409
  | 'EVENT_ALREADY_CANCELLED'       // 409
  | 'CANNOT_EDIT_PUBLISHED_EVENT'   // 409 — některá pole jsou po publikaci zamčena
  | 'TICKET_TYPE_NOT_FOUND'         // 404
  | 'TICKET_TYPE_HAS_SALES'         // 409 — nelze smazat, pokud jsou prodané vstupenky
  | 'INVALID_DATE_RANGE'            // 400
  | 'INVALID_PRICE'                 // 400 — cena < 0
  | 'VALIDATION_ERROR';             // 400 — obecná validační chyba

const STATUS_MAP: Record<EventManagementErrorCode, number> = {
  EVENT_NOT_FOUND: 404,
  EVENT_NOT_OWNED: 404,             // anti-enumerace: vracíme 404 místo 403
  EVENT_ALREADY_PUBLISHED: 409,
  EVENT_ALREADY_CANCELLED: 409,
  CANNOT_EDIT_PUBLISHED_EVENT: 409,
  TICKET_TYPE_NOT_FOUND: 404,
  TICKET_TYPE_HAS_SALES: 409,
  INVALID_DATE_RANGE: 400,
  INVALID_PRICE: 400,
  VALIDATION_ERROR: 400,
};

export class EventManagementError extends Error {
  public readonly code: EventManagementErrorCode;
  public readonly statusCode: number;

  constructor(code: EventManagementErrorCode, message: string, statusCode?: number) {
    super(message);
    this.name = 'EventManagementError';
    this.code = code;
    this.statusCode = statusCode ?? STATUS_MAP[code];
    Object.setPrototypeOf(this, new.target.prototype);
  }

  toHttpError(): { error: { code: string; message: string } } {
    return {
      error: {
        code: this.code,
        message: this.message,
      },
    };
  }
}
