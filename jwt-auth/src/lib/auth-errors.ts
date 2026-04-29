export type AuthErrorCode =
  | 'TOKEN_MISSING'         // 401 — chybí Authorization header
  | 'TOKEN_INVALID'         // 401 — JWT nelze ověřit
  | 'TOKEN_EXPIRED'         // 401 — JWT vypršelo
  | 'TOKEN_REVOKED'         // 401 — token revokován
  | 'REFRESH_TOKEN_REUSE'   // 401 — detekce token theft (family reuse)
  | 'INSUFFICIENT_ROLE'     // 403 — user nemá požadovanou roli
  | 'NOT_PROMOTER_MEMBER'   // 403 — user není členem promotéra
  | 'ADMIN_REQUIRED'        // 403 — endpoint vyžaduje admin
  | 'USER_NOT_FOUND'        // 401
  | 'PROMOTER_NOT_FOUND';   // 404

const STATUS_CODES: Record<AuthErrorCode, number> = {
  TOKEN_MISSING: 401,
  TOKEN_INVALID: 401,
  TOKEN_EXPIRED: 401,
  TOKEN_REVOKED: 401,
  REFRESH_TOKEN_REUSE: 401,
  INSUFFICIENT_ROLE: 403,
  NOT_PROMOTER_MEMBER: 403,
  ADMIN_REQUIRED: 403,
  USER_NOT_FOUND: 401,
  PROMOTER_NOT_FOUND: 404,
};

const DEFAULT_MESSAGES: Record<AuthErrorCode, string> = {
  TOKEN_MISSING: 'Authorization header is missing',
  TOKEN_INVALID: 'Token is invalid or cannot be verified',
  TOKEN_EXPIRED: 'Token has expired',
  TOKEN_REVOKED: 'Token has been revoked',
  REFRESH_TOKEN_REUSE: 'Refresh token reuse detected — potential token theft',
  INSUFFICIENT_ROLE: 'Insufficient role for this operation',
  NOT_PROMOTER_MEMBER: 'User is not a member of this promoter',
  ADMIN_REQUIRED: 'Platform admin access required',
  USER_NOT_FOUND: 'User not found',
  PROMOTER_NOT_FOUND: 'Promoter not found',
};

export interface HttpError {
  code: AuthErrorCode;
  message: string;
  status: number;
}

export class AuthError extends Error {
  public readonly code: AuthErrorCode;
  public readonly status: number;

  constructor(code: AuthErrorCode, message?: string) {
    super(message ?? DEFAULT_MESSAGES[code]);
    this.name = 'AuthError';
    this.code = code;
    this.status = STATUS_CODES[code];
    // Preserve prototype chain in compiled JS
    Object.setPrototypeOf(this, AuthError.prototype);
  }

  toHttpError(): HttpError {
    return {
      code: this.code,
      message: this.message,
      status: this.status,
    };
  }

  toResponse(): Response {
    return new Response(
      JSON.stringify({ error: { code: this.code, message: this.message } }),
      {
        status: this.status,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}

export function getStatusCode(code: AuthErrorCode): number {
  return STATUS_CODES[code];
}
