/**
 * OAuth 2.0 error codes per RFC 6749 section 5.2.
 */
export type OAuthErrorCode =
  | 'invalid_request'
  | 'invalid_client'
  | 'invalid_grant'
  | 'unauthorized_client'
  | 'unsupported_grant_type'
  | 'unsupported_response_type'
  | 'invalid_scope'
  | 'server_error'
  | 'temporarily_unavailable'
  | 'access_denied';

const HTTP_STATUS: Record<OAuthErrorCode, number> = {
  invalid_request: 400,
  invalid_client: 401,
  invalid_grant: 400,
  unauthorized_client: 403,
  unsupported_grant_type: 400,
  unsupported_response_type: 400,
  invalid_scope: 400,
  server_error: 500,
  temporarily_unavailable: 503,
  access_denied: 403,
};

export class OAuthError extends Error {
  readonly code: OAuthErrorCode;
  readonly statusCode: number;
  readonly description: string;
  constructor(code: OAuthErrorCode, description: string) {
    super(description);
    this.code = code;
    this.description = description;
    this.statusCode = HTTP_STATUS[code];
    this.name = 'OAuthError';
  }
  toHttpError() {
    return { error: this.code, error_description: this.description };
  }
}

export function isOAuthError(err: unknown): err is OAuthError {
  return err instanceof OAuthError;
}
