export type SnippetErrorCode =
  | 'SNIPPET_NOT_FOUND'
  | 'INVALID_FORMAT'
  | 'KEY_REQUIRED'
  | 'CONTENT_TOO_LARGE';

const STATUS_MAP: Record<SnippetErrorCode, number> = {
  SNIPPET_NOT_FOUND: 404,
  INVALID_FORMAT: 400,
  KEY_REQUIRED: 400,
  CONTENT_TOO_LARGE: 413,
};

const MESSAGES: Record<SnippetErrorCode, string> = {
  SNIPPET_NOT_FOUND: 'Textový úryvek nebyl nalezen.',
  INVALID_FORMAT: 'Neplatný formát úryvku.',
  KEY_REQUIRED: 'Klíč úryvku je povinný.',
  CONTENT_TOO_LARGE: 'Obsah úryvku přesahuje maximální velikost 64 KB.',
};

export const MAX_CONTENT_BYTES = 64 * 1024;

export class SnippetError extends Error {
  public readonly code: SnippetErrorCode;
  public readonly status: number;

  constructor(code: SnippetErrorCode, message?: string) {
    super(message ?? MESSAGES[code]);
    this.name = 'SnippetError';
    this.code = code;
    this.status = STATUS_MAP[code];
  }
}
