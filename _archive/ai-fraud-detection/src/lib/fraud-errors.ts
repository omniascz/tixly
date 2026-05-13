// =============================================================================
// AiFraudError — typed errors for the AI fraud detection module
// =============================================================================

export type AiFraudErrorCode =
  | 'SUBJECT_NOT_FOUND'
  | 'DETECTION_FAILED'
  | 'INVALID_THRESHOLD';

const STATUS_BY_CODE: Record<AiFraudErrorCode, number> = {
  SUBJECT_NOT_FOUND: 404,
  DETECTION_FAILED: 500,
  INVALID_THRESHOLD: 400,
};

const MESSAGE_BY_CODE: Record<AiFraudErrorCode, string> = {
  SUBJECT_NOT_FOUND: 'Subject not found',
  DETECTION_FAILED: 'Detection run failed',
  INVALID_THRESHOLD: 'Invalid threshold value',
};

export class AiFraudError extends Error {
  public readonly code: AiFraudErrorCode;
  public readonly status: number;

  constructor(code: AiFraudErrorCode, message?: string) {
    super(message ?? MESSAGE_BY_CODE[code]);
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.name = 'AiFraudError';
  }
}
