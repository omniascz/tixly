type PortalErrorCode =
  | 'SPEC_NOT_FOUND'
  | 'SPEC_PARSE_ERROR'
  | 'PATH_NOT_FOUND'
  | 'EXAMPLE_NOT_FOUND'
  | 'INVALID_VERSION';

const HTTP_STATUS: Record<PortalErrorCode, number> = {
  SPEC_NOT_FOUND: 404,
  SPEC_PARSE_ERROR: 500,
  PATH_NOT_FOUND: 404,
  EXAMPLE_NOT_FOUND: 404,
  INVALID_VERSION: 400,
};

export class PortalError extends Error {
  readonly code: PortalErrorCode;
  readonly statusCode: number;
  constructor(code: PortalErrorCode, message?: string) {
    super(message ?? code);
    this.code = code;
    this.statusCode = HTTP_STATUS[code];
    this.name = 'PortalError';
  }
  toHttpError() { return { error: this.code, message: this.message, statusCode: this.statusCode }; }
}

export function isPortalError(err: unknown): err is PortalError { return err instanceof PortalError; }
