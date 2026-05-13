export type NewsletterErrorCode =
  | 'EMAIL_INVALID'
  | 'ALREADY_SUBSCRIBED'
  | 'ALREADY_UNSUBSCRIBED'
  | 'TOKEN_INVALID'
  | 'TOKEN_EXPIRED'
  | 'SUBSCRIBER_NOT_FOUND';

const MESSAGES: Record<NewsletterErrorCode, string> = {
  EMAIL_INVALID: 'Neplatná e-mailová adresa.',
  ALREADY_SUBSCRIBED: 'Tento e-mail je již přihlášen k odběru newsletteru.',
  ALREADY_UNSUBSCRIBED: 'Tento odběratel již byl odhlášen.',
  TOKEN_INVALID: 'Neplatný potvrzovací odkaz.',
  TOKEN_EXPIRED: 'Platnost potvrzovacího odkazu vypršela.',
  SUBSCRIBER_NOT_FOUND: 'Odběratel nebyl nalezen.',
};

const STATUS_CODES: Record<NewsletterErrorCode, number> = {
  EMAIL_INVALID: 400,
  ALREADY_SUBSCRIBED: 409,
  ALREADY_UNSUBSCRIBED: 410,
  TOKEN_INVALID: 400,
  TOKEN_EXPIRED: 400,
  SUBSCRIBER_NOT_FOUND: 404,
};

export class NewsletterError extends Error {
  public readonly code: NewsletterErrorCode;
  public readonly statusCode: number;

  constructor(code: NewsletterErrorCode, message?: string) {
    super(message ?? MESSAGES[code]);
    this.name = 'NewsletterError';
    this.code = code;
    this.statusCode = STATUS_CODES[code];
  }
}
