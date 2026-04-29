// =============================================================================
// Permanentky — chybové kódy
// =============================================================================

export type PermanentkyErrorCode =
  | 'TEMPLATE_NOT_FOUND'
  | 'TEMPLATE_INACTIVE'
  | 'PACKAGE_NOT_FOUND'
  | 'PACKAGE_NOT_OWNED'
  | 'PACKAGE_EXPIRED'
  | 'PACKAGE_DEPLETED'
  | 'PACKAGE_NOT_ACTIVE'
  | 'INSUFFICIENT_CREDITS'
  | 'INVALID_VALIDITY_DAYS'
  | 'REFUND_PERIOD_EXPIRED'
  | 'DUPLICATE_USAGE';

const STATUS_MAP: Record<PermanentkyErrorCode, number> = {
  TEMPLATE_NOT_FOUND: 404,
  TEMPLATE_INACTIVE: 409,
  PACKAGE_NOT_FOUND: 404,
  PACKAGE_NOT_OWNED: 403,
  PACKAGE_EXPIRED: 409,
  PACKAGE_DEPLETED: 409,
  PACKAGE_NOT_ACTIVE: 409,
  INSUFFICIENT_CREDITS: 402,
  INVALID_VALIDITY_DAYS: 400,
  REFUND_PERIOD_EXPIRED: 409,
  DUPLICATE_USAGE: 409,
};

const MESSAGE_MAP: Record<PermanentkyErrorCode, string> = {
  TEMPLATE_NOT_FOUND: 'Šablona permanentky nebyla nalezena.',
  TEMPLATE_INACTIVE: 'Šablona permanentky není aktivní.',
  PACKAGE_NOT_FOUND: 'Permanentka nebyla nalezena.',
  PACKAGE_NOT_OWNED: 'Tato permanentka nepatří danému klientovi.',
  PACKAGE_EXPIRED: 'Platnost permanentky vypršela.',
  PACKAGE_DEPLETED: 'Permanentka již nemá žádné zbývající kredity.',
  PACKAGE_NOT_ACTIVE: 'Permanentka není aktivní (čeká na platbu nebo byla vrácena).',
  INSUFFICIENT_CREDITS: 'Nedostatek kreditů.',
  INVALID_VALIDITY_DAYS: 'Neplatná doba platnosti permanentky.',
  REFUND_PERIOD_EXPIRED: 'Lhůta pro vrácení kreditu vypršela.',
  DUPLICATE_USAGE: 'Tato rezervace již byla z permanentky odečtena.',
};

export class PermanentkyError extends Error {
  public readonly code: PermanentkyErrorCode;
  public readonly status: number;

  constructor(code: PermanentkyErrorCode, detail?: string) {
    const base = MESSAGE_MAP[code];
    super(detail ? `${base} ${detail}` : base);
    this.name = 'PermanentkyError';
    this.code = code;
    this.status = STATUS_MAP[code];
  }

  toJSON() {
    return {
      error: this.code,
      message: this.message,
      status: this.status,
    };
  }
}
