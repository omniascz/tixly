// Identity verification error codes and typed error class.

export const IdentityErrorCode = {
  STATE_NOT_FOUND:        'STATE_NOT_FOUND',
  STATE_EXPIRED:          'STATE_EXPIRED',
  TOKEN_EXCHANGE_FAILED:  'TOKEN_EXCHANGE_FAILED',
  USERINFO_FAILED:        'USERINFO_FAILED',
  ENCRYPTION_KEY_MISSING: 'ENCRYPTION_KEY_MISSING',
  USER_NOT_FOUND:         'USER_NOT_FOUND',
  NOT_VERIFIED:           'NOT_VERIFIED',
  ACR_INSUFFICIENT:       'ACR_INSUFFICIENT',
  ONFIDO_NOT_CONFIGURED:     'ONFIDO_NOT_CONFIGURED',
  ONFIDO_API_ERROR:          'ONFIDO_API_ERROR',
  ONFIDO_INVALID_WEBHOOK:    'ONFIDO_INVALID_WEBHOOK',
  ONFIDO_VERIFICATION_PENDING: 'ONFIDO_VERIFICATION_PENDING',
  ONFIDO_VERIFICATION_FAILED:  'ONFIDO_VERIFICATION_FAILED',
} as const;

/** Czech user-facing messages + HTTP status codes for Onfido errors. */
export const ONFIDO_ERROR_MESSAGES: Record<string, { message: string; status: number }> = {
  ONFIDO_NOT_CONFIGURED:       { message: 'Ověření Onfido není nakonfigurováno.',           status: 500 },
  ONFIDO_API_ERROR:            { message: 'Chyba při komunikaci se službou Onfido.',        status: 502 },
  ONFIDO_INVALID_WEBHOOK:      { message: 'Neplatný podpis webhooku Onfido.',               status: 400 },
  ONFIDO_VERIFICATION_PENDING: { message: 'Ověření totožnosti již probíhá.',                status: 409 },
  ONFIDO_VERIFICATION_FAILED:  { message: 'Ověření totožnosti se nezdařilo.',               status: 422 },
};

export type IdentityErrorCode = typeof IdentityErrorCode[keyof typeof IdentityErrorCode];

export class IdentityError extends Error {
  readonly code: IdentityErrorCode;

  constructor(code: IdentityErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'IdentityError';
    this.code = code;
  }
}
