export type FeeErrorCode =
  | 'FEE_SCHEDULE_NOT_FOUND'   // 404
  | 'NO_ACTIVE_SCHEDULE'        // 422 — promotér nemá aktivní fee schedule
  | 'INVALID_PRICE'             // 422 — cena musí být >= 0 INTEGER
  | 'UNAUTHORIZED'              // 401
  | 'TIER_NOT_FOUND'            // 404 — promotér nemá přiřazen tier
  | 'INVALID_TIER';             // 400 — neplatná hodnota tieru

const STATUS_MAP: Record<FeeErrorCode, number> = {
  FEE_SCHEDULE_NOT_FOUND: 404,
  NO_ACTIVE_SCHEDULE: 422,
  INVALID_PRICE: 422,
  UNAUTHORIZED: 401,
  TIER_NOT_FOUND: 404,
  INVALID_TIER: 400,
};

export class FeeError extends Error {
  public readonly code: FeeErrorCode;
  public readonly statusCode: number;

  constructor(code: FeeErrorCode, message: string, statusCode?: number) {
    super(message);
    this.name = 'FeeError';
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
