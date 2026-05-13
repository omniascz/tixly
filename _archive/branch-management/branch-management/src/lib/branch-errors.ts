// ---------------------------------------------------------------------------
// Branch Management — Error codes
// ---------------------------------------------------------------------------

export type BranchErrorCode =
  | 'BRANCH_NOT_FOUND'              // 404
  | 'BRANCH_DUPLICATE'              // 409
  | 'BRANCH_INACTIVE'               // 409
  | 'HOURS_CONFLICT'                // 409
  | 'CLOSURE_CONFLICT'              // 409
  | 'CLOSURE_NOT_FOUND'             // 404
  | 'STAFF_NOT_FOUND'               // 404
  | 'STAFF_DUPLICATE'               // 409
  | 'SETTING_NOT_FOUND'             // 404
  | 'SERVICE_NOT_AVAILABLE_AT_BRANCH'; // 409

const HTTP_STATUS: Record<BranchErrorCode, number> = {
  BRANCH_NOT_FOUND: 404,
  BRANCH_DUPLICATE: 409,
  BRANCH_INACTIVE: 409,
  HOURS_CONFLICT: 409,
  CLOSURE_CONFLICT: 409,
  CLOSURE_NOT_FOUND: 404,
  STAFF_NOT_FOUND: 404,
  STAFF_DUPLICATE: 409,
  SETTING_NOT_FOUND: 404,
  SERVICE_NOT_AVAILABLE_AT_BRANCH: 409,
};

const DEFAULT_MESSAGES: Record<BranchErrorCode, string> = {
  BRANCH_NOT_FOUND: 'Branch not found.',
  BRANCH_DUPLICATE: 'A branch with this slug already exists for this promoter.',
  BRANCH_INACTIVE: 'Branch is inactive.',
  HOURS_CONFLICT: 'Hours conflict for this day.',
  CLOSURE_CONFLICT: 'A closure already exists for this date.',
  CLOSURE_NOT_FOUND: 'Closure not found.',
  STAFF_NOT_FOUND: 'Staff member not found.',
  STAFF_DUPLICATE: 'This user is already assigned to this branch.',
  SETTING_NOT_FOUND: 'Setting not found.',
  SERVICE_NOT_AVAILABLE_AT_BRANCH: 'Service is not available at this branch.',
};

export class BranchError extends Error {
  public readonly code: BranchErrorCode;
  public readonly statusCode: number;

  constructor(code: BranchErrorCode, message?: string) {
    super(message ?? DEFAULT_MESSAGES[code]);
    this.name = 'BranchError';
    this.code = code;
    this.statusCode = HTTP_STATUS[code];
    Object.setPrototypeOf(this, BranchError.prototype);
  }

  toHttpError() {
    return { error: this.code, message: this.message, statusCode: this.statusCode };
  }
}

export function isBranchError(err: unknown): err is BranchError {
  return err instanceof BranchError;
}
