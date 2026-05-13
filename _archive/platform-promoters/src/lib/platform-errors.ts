export type PlatformErrorCode =
  | 'PROMOTER_NOT_FOUND'
  | 'PROMOTER_SLUG_TAKEN'
  | 'PROMOTER_ALREADY_ACTIVE'
  | 'PROMOTER_SUSPENDED'
  | 'MEMBER_NOT_FOUND'
  | 'MEMBER_ALREADY_EXISTS'
  | 'CANNOT_REMOVE_OWNER'
  | 'UNAUTHORIZED'
  | 'KYC_NOT_VERIFIED'
  | 'INVALID_STATUS_TRANSITION';

const ERROR_STATUS_MAP: Record<PlatformErrorCode, number> = {
  PROMOTER_NOT_FOUND: 404,
  PROMOTER_SLUG_TAKEN: 409,
  PROMOTER_ALREADY_ACTIVE: 409,
  PROMOTER_SUSPENDED: 403,
  MEMBER_NOT_FOUND: 404,
  MEMBER_ALREADY_EXISTS: 409,
  CANNOT_REMOVE_OWNER: 422,
  UNAUTHORIZED: 404,
  KYC_NOT_VERIFIED: 422,
  INVALID_STATUS_TRANSITION: 422,
};

export class PlatformError extends Error {
  readonly code: PlatformErrorCode;
  readonly statusCode: number;

  constructor(code: PlatformErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'PlatformError';
    this.code = code;
    this.statusCode = ERROR_STATUS_MAP[code];
    Object.setPrototypeOf(this, PlatformError.prototype);
  }

  toHttpError(): { statusCode: number; code: PlatformErrorCode; message: string } {
    return {
      statusCode: this.statusCode,
      code: this.code,
      message: this.message,
    };
  }
}

export function isPlatformError(err: unknown): err is PlatformError {
  return err instanceof PlatformError;
}
