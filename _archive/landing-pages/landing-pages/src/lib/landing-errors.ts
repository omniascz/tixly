export type LandingErrorCode =
  | 'PAGE_NOT_FOUND'
  | 'PAGE_NOT_OWNED'
  | 'SLUG_DUPLICATE'
  | 'BLOCK_NOT_FOUND'
  | 'INVALID_BLOCK_TYPE'
  | 'STATIC_FILE_NOT_FOUND'
  | 'INVALID_HREFLANG';

const STATUS_MAP: Record<LandingErrorCode, number> = {
  PAGE_NOT_FOUND: 404,
  PAGE_NOT_OWNED: 403,
  SLUG_DUPLICATE: 409,
  BLOCK_NOT_FOUND: 404,
  INVALID_BLOCK_TYPE: 400,
  STATIC_FILE_NOT_FOUND: 404,
  INVALID_HREFLANG: 400,
};

const MESSAGES: Record<LandingErrorCode, string> = {
  PAGE_NOT_FOUND: 'Stránka nebyla nalezena.',
  PAGE_NOT_OWNED: 'K této stránce nemáte přístup.',
  SLUG_DUPLICATE: 'Stránka s tímto slugem již existuje.',
  BLOCK_NOT_FOUND: 'Blok nebyl nalezen.',
  INVALID_BLOCK_TYPE: 'Neplatný typ bloku.',
  STATIC_FILE_NOT_FOUND: 'Statický HTML soubor nebyl nalezen.',
  INVALID_HREFLANG: 'Neplatná konfigurace hreflang.',
};

export class LandingPageError extends Error {
  public readonly code: LandingErrorCode;
  public readonly status: number;

  constructor(code: LandingErrorCode, message?: string) {
    super(message ?? MESSAGES[code]);
    this.name = 'LandingPageError';
    this.code = code;
    this.status = STATUS_MAP[code];
  }
}
