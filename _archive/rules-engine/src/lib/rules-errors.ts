// ---------------------------------------------------------------------------
// Rules Engine — Error codes
// ---------------------------------------------------------------------------

export type RuleErrorCode =
  | 'RULE_NOT_FOUND'           // 404
  | 'RULE_DUPLICATE'           // 409
  | 'CONDITION_NOT_FOUND'      // 404
  | 'ACTION_NOT_FOUND'         // 404
  | 'RULE_BLOCKED'             // 422 — block action fired
  | 'APPROVAL_REQUIRED'        // 202 — approval action fired
  | 'APPROVAL_NOT_FOUND'       // 404
  | 'APPROVAL_EXPIRED'         // 410
  | 'APPROVAL_ALREADY_DECIDED' // 409
  | 'DISCOUNT_APPLIED';        // 200 informational

const HTTP_STATUS: Record<RuleErrorCode, number> = {
  RULE_NOT_FOUND: 404,
  RULE_DUPLICATE: 409,
  CONDITION_NOT_FOUND: 404,
  ACTION_NOT_FOUND: 404,
  RULE_BLOCKED: 422,
  APPROVAL_REQUIRED: 202,
  APPROVAL_NOT_FOUND: 404,
  APPROVAL_EXPIRED: 410,
  APPROVAL_ALREADY_DECIDED: 409,
  DISCOUNT_APPLIED: 200,
};

const DEFAULT_MESSAGES: Record<RuleErrorCode, string> = {
  RULE_NOT_FOUND: 'Rule not found.',
  RULE_DUPLICATE: 'A rule with this name already exists for this promoter.',
  CONDITION_NOT_FOUND: 'Condition not found.',
  ACTION_NOT_FOUND: 'Action not found.',
  RULE_BLOCKED: 'Booking blocked by rule.',
  APPROVAL_REQUIRED: 'Booking requires manager approval.',
  APPROVAL_NOT_FOUND: 'Approval request not found.',
  APPROVAL_EXPIRED: 'Approval request has expired.',
  APPROVAL_ALREADY_DECIDED: 'Approval request has already been decided.',
  DISCOUNT_APPLIED: 'Discount applied.',
};

export class RuleError extends Error {
  public readonly code: RuleErrorCode;
  public readonly statusCode: number;

  constructor(code: RuleErrorCode, message?: string) {
    super(message ?? DEFAULT_MESSAGES[code]);
    this.name = 'RuleError';
    this.code = code;
    this.statusCode = HTTP_STATUS[code];
    Object.setPrototypeOf(this, RuleError.prototype);
  }

  toHttpError() {
    return { error: this.code, message: this.message, statusCode: this.statusCode };
  }
}

export function isRuleError(err: unknown): err is RuleError {
  return err instanceof RuleError;
}
