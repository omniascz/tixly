type SandboxErrorCode =
  | 'TENANT_NOT_FOUND'
  | 'TENANT_ALREADY_EXISTS'
  | 'TENANT_LIMIT_REACHED'
  | 'TENANT_EXPIRED'
  | 'INVALID_SCENARIO'
  | 'MOCK_REQUEST_INVALID'
  | 'CARD_TEST_TOKEN';      // thrown by mock payment to simulate failures

const HTTP_STATUS: Record<SandboxErrorCode, number> = {
  TENANT_NOT_FOUND: 404,
  TENANT_ALREADY_EXISTS: 409,
  TENANT_LIMIT_REACHED: 422,
  TENANT_EXPIRED: 410,
  INVALID_SCENARIO: 400,
  MOCK_REQUEST_INVALID: 400,
  CARD_TEST_TOKEN: 402,
};

export class SandboxError extends Error {
  readonly code: SandboxErrorCode;
  readonly statusCode: number;
  constructor(code: SandboxErrorCode, message?: string) {
    super(message ?? code);
    this.code = code;
    this.statusCode = HTTP_STATUS[code];
    this.name = 'SandboxError';
  }
  toHttpError() { return { error: this.code, message: this.message, statusCode: this.statusCode }; }
}

export function isSandboxError(err: unknown): err is SandboxError { return err instanceof SandboxError; }
