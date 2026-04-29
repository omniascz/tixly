type BenefitErrorCode =
  | 'EMPLOYER_NOT_FOUND'
  | 'EMPLOYEE_NOT_FOUND'
  | 'PROGRAM_NOT_FOUND'
  | 'ALLOCATION_NOT_FOUND'
  | 'INSUFFICIENT_BALANCE'
  | 'CATEGORY_NOT_ALLOWED'
  | 'EMPLOYEE_INACTIVE'
  | 'ALLOCATION_EXPIRED'
  | 'DUPLICATE_EMPLOYEE'
  | 'INVALID_AMOUNT';

const HTTP_STATUS: Record<BenefitErrorCode, number> = {
  EMPLOYER_NOT_FOUND: 404, EMPLOYEE_NOT_FOUND: 404, PROGRAM_NOT_FOUND: 404,
  ALLOCATION_NOT_FOUND: 404, INSUFFICIENT_BALANCE: 402, CATEGORY_NOT_ALLOWED: 403,
  EMPLOYEE_INACTIVE: 422, ALLOCATION_EXPIRED: 422, DUPLICATE_EMPLOYEE: 409, INVALID_AMOUNT: 400,
};

const DEFAULT_MESSAGES: Record<BenefitErrorCode, string> = {
  EMPLOYER_NOT_FOUND: 'Zaměstnavatel nenalezen.',
  EMPLOYEE_NOT_FOUND: 'Zaměstnanec nenalezen.',
  PROGRAM_NOT_FOUND: 'Benefit program nenalezen.',
  ALLOCATION_NOT_FOUND: 'Alokace nenalezena.',
  INSUFFICIENT_BALANCE: 'Nedostatečný zůstatek na benefit účtu.',
  CATEGORY_NOT_ALLOWED: 'Tato kategorie není v benefit programu povolena.',
  EMPLOYEE_INACTIVE: 'Zaměstnanec není aktivní.',
  ALLOCATION_EXPIRED: 'Alokace vypršela.',
  DUPLICATE_EMPLOYEE: 'Zaměstnanec s tímto emailem již existuje.',
  INVALID_AMOUNT: 'Neplatná částka.',
};

export class BenefitError extends Error {
  readonly code: BenefitErrorCode;
  readonly statusCode: number;
  constructor(code: BenefitErrorCode, message?: string) {
    super(message ?? DEFAULT_MESSAGES[code]);
    this.code = code;
    this.statusCode = HTTP_STATUS[code];
    this.name = 'BenefitError';
  }
  toHttpError() { return { error: this.code, message: this.message, statusCode: this.statusCode }; }
}

export function isBenefitError(err: unknown): err is BenefitError { return err instanceof BenefitError; }

// Shared categories — what credits can be spent on
export const BENEFIT_CATEGORIES = [
  'sport',
  'culture',
  'food',
  'education',
  'wellness',
  'travel',
  'health',
  'transport',
] as const;

export type BenefitCategory = (typeof BENEFIT_CATEGORIES)[number];

export function isValidCategory(c: string): c is BenefitCategory {
  return (BENEFIT_CATEGORIES as readonly string[]).includes(c);
}
