type DeviceErrorCode =
  | 'VELOCITY_EXCEEDED'
  | 'FINGERPRINT_BLOCKED'
  | 'INVALID_SIGNALS';

const HTTP_STATUS: Record<DeviceErrorCode, number> = {
  VELOCITY_EXCEEDED:    429,
  FINGERPRINT_BLOCKED:  403,
  INVALID_SIGNALS:      400,
};

const DEFAULT_MESSAGES: Record<DeviceErrorCode, string> = {
  VELOCITY_EXCEEDED:    'Purchase velocity limit exceeded',
  FINGERPRINT_BLOCKED:  'Device fingerprint is blocked',
  INVALID_SIGNALS:      'Invalid fingerprint signals',
};

export class DeviceError extends Error {
  readonly code: DeviceErrorCode;
  readonly statusCode: number;
  constructor(code: DeviceErrorCode, message?: string) {
    super(message ?? DEFAULT_MESSAGES[code]);
    this.code = code;
    this.statusCode = HTTP_STATUS[code];
    this.name = 'DeviceError';
  }
  toHttpError() {
    return { error: this.code, statusCode: this.statusCode, message: this.message };
  }
}

export function isDeviceError(err: unknown): err is DeviceError {
  return err instanceof DeviceError;
}
