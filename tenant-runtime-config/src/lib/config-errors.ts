export type RuntimeConfigErrorCode =
  | 'CONFIG_NOT_FOUND'
  | 'INVALID_TYPE'
  | 'VALIDATION_FAILED';

const STATUS_MAP: Record<RuntimeConfigErrorCode, number> = {
  CONFIG_NOT_FOUND: 404,
  INVALID_TYPE: 400,
  VALIDATION_FAILED: 422,
};

const MESSAGES: Record<RuntimeConfigErrorCode, string> = {
  CONFIG_NOT_FOUND: 'Konfigurační záznam nebyl nalezen.',
  INVALID_TYPE: 'Neplatný typ hodnoty.',
  VALIDATION_FAILED: 'Hodnota neprošla validací.',
};

export class RuntimeConfigError extends Error {
  public readonly code: RuntimeConfigErrorCode;
  public readonly status: number;

  constructor(code: RuntimeConfigErrorCode, message?: string) {
    super(message ?? MESSAGES[code]);
    this.name = 'RuntimeConfigError';
    this.code = code;
    this.status = STATUS_MAP[code];
  }
}
