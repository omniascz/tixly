// =============================================================================
// Action log — typed errors
// =============================================================================

export type ActionLogErrorCode =
  | 'ACTION_NOT_FOUND'       // 404
  | 'ALREADY_ROLLED_BACK'    // 409
  | 'NOT_ROLLBACKABLE'       // 409
  | 'ROLLBACK_FAILED'        // 500
  | 'NO_HANDLER_REGISTERED'; // 500

const HTTP_STATUS: Record<ActionLogErrorCode, number> = {
  ACTION_NOT_FOUND: 404,
  ALREADY_ROLLED_BACK: 409,
  NOT_ROLLBACKABLE: 409,
  ROLLBACK_FAILED: 500,
  NO_HANDLER_REGISTERED: 500,
};

const DEFAULT_MESSAGES: Record<ActionLogErrorCode, string> = {
  ACTION_NOT_FOUND: 'Záznam akce nebyl nalezen.',
  ALREADY_ROLLED_BACK: 'Tato akce už byla vrácena zpět.',
  NOT_ROLLBACKABLE: 'Tuto akci nelze automaticky vrátit zpět.',
  ROLLBACK_FAILED: 'Vrácení akce selhalo.',
  NO_HANDLER_REGISTERED: 'Pro tento typ entity není registrován rollback handler.',
};

export class ActionLogError extends Error {
  public readonly code: ActionLogErrorCode;
  public readonly statusCode: number;

  constructor(code: ActionLogErrorCode, message?: string) {
    super(message ?? DEFAULT_MESSAGES[code]);
    this.name = 'ActionLogError';
    this.code = code;
    this.statusCode = HTTP_STATUS[code];
    Object.setPrototypeOf(this, ActionLogError.prototype);
  }

  toHttpError() {
    return { error: this.code, message: this.message, statusCode: this.statusCode };
  }
}

export function isActionLogError(err: unknown): err is ActionLogError {
  return err instanceof ActionLogError;
}
