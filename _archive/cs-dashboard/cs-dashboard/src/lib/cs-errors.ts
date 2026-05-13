type CsErrorCode =
  | 'ORDER_NOT_FOUND'
  | 'TICKET_NOT_FOUND'
  | 'CUSTOMER_NOT_FOUND'
  | 'ORDER_NOT_REFUNDABLE'
  | 'ORDER_ALREADY_CANCELLED'
  | 'TICKET_ALREADY_TRANSFERRED'
  | 'TICKET_NOT_REISSUABLE'
  | 'INVALID_REFUND_AMOUNT'
  | 'SEARCH_QUERY_TOO_SHORT'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN';

const HTTP_STATUS: Record<CsErrorCode, number> = {
  ORDER_NOT_FOUND:            404,
  TICKET_NOT_FOUND:           404,
  CUSTOMER_NOT_FOUND:         404,
  ORDER_NOT_REFUNDABLE:       422,
  ORDER_ALREADY_CANCELLED:    409,
  TICKET_ALREADY_TRANSFERRED: 409,
  TICKET_NOT_REISSUABLE:      422,
  INVALID_REFUND_AMOUNT:      422,
  SEARCH_QUERY_TOO_SHORT:     400,
  UNAUTHORIZED:               401,
  FORBIDDEN:                  403,
};

const DEFAULT_MESSAGES: Record<CsErrorCode, string> = {
  ORDER_NOT_FOUND:            'Objednávka nenalezena',
  TICKET_NOT_FOUND:           'Vstupenka nenalezena',
  CUSTOMER_NOT_FOUND:         'Zákazník nenalezen',
  ORDER_NOT_REFUNDABLE:       'Objednávka není způsobilá k vrácení peněz',
  ORDER_ALREADY_CANCELLED:    'Objednávka je již zrušena',
  TICKET_ALREADY_TRANSFERRED: 'Vstupenka byla již převedena',
  TICKET_NOT_REISSUABLE:      'Vstupenka nemůže být znovu vydána (je zrušena nebo neplatná)',
  INVALID_REFUND_AMOUNT:      'Částka vrácení přesahuje zbývající hodnotu objednávky',
  SEARCH_QUERY_TOO_SHORT:     'Vyhledávací dotaz je příliš krátký (min. 3 znaky)',
  UNAUTHORIZED:               'Vyžadováno ID CS agenta',
  FORBIDDEN:                  'Přístup odepřen — vyžadováno oprávnění administrátora',
};

export class CsError extends Error {
  readonly code: CsErrorCode;
  readonly statusCode: number;
  constructor(code: CsErrorCode, message?: string) {
    super(message ?? DEFAULT_MESSAGES[code]);
    this.code = code;
    this.statusCode = HTTP_STATUS[code];
    this.name = 'CsError';
  }
  toHttpError() {
    return { error: this.code, statusCode: this.statusCode, message: this.message };
  }
}

export function isCsError(err: unknown): err is CsError {
  return err instanceof CsError;
}
