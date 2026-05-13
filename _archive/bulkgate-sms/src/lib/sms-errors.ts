// =============================================================================
// Typed errors pro SMS systém — české zprávy
// =============================================================================

export type SmsErrorCode =
  | 'SMS_NOT_CONFIGURED'
  | 'SMS_INVALID_PHONE'
  | 'SMS_TEXT_TOO_LONG'
  | 'SMS_PROVIDER_ERROR'
  | 'SMS_RATE_LIMITED'
  | 'SMS_INSUFFICIENT_CREDIT'
  | 'SMS_RECIPIENT_OPTED_OUT';

const STATUS_MAP: Record<SmsErrorCode, number> = {
  SMS_NOT_CONFIGURED: 500,
  SMS_INVALID_PHONE: 400,
  SMS_TEXT_TOO_LONG: 400,
  SMS_PROVIDER_ERROR: 502,
  SMS_RATE_LIMITED: 429,
  SMS_INSUFFICIENT_CREDIT: 402,
  SMS_RECIPIENT_OPTED_OUT: 403,
};

const MESSAGE_MAP: Record<SmsErrorCode, string> = {
  SMS_NOT_CONFIGURED:
    'SMS brána není nakonfigurována. Zkontrolujte BULKGATE_APP_ID a BULKGATE_APP_TOKEN.',
  SMS_INVALID_PHONE:
    'Neplatné telefonní číslo. Použijte mezinárodní formát E.164 (např. +420601234567).',
  SMS_TEXT_TOO_LONG:
    'Text SMS zprávy je příliš dlouhý. Maximum je 1530 znaků (10 segmentů).',
  SMS_PROVIDER_ERROR:
    'Chyba při komunikaci se SMS poskytovatelem. Zkuste to prosím znovu.',
  SMS_RATE_LIMITED:
    'Překročen limit odesílání SMS. Počkejte chvíli a zkuste to znovu.',
  SMS_INSUFFICIENT_CREDIT:
    'Nedostatek kreditu na SMS bráně. Dobijte si prosím kredit.',
  SMS_RECIPIENT_OPTED_OUT:
    'Příjemce se odhlásil z odběru marketingových SMS zpráv.',
};

export class SmsError extends Error {
  public readonly code: SmsErrorCode;
  public readonly statusCode: number;
  public readonly cause?: unknown;

  constructor(code: SmsErrorCode, messageOverride?: string, cause?: unknown) {
    super(messageOverride ?? MESSAGE_MAP[code]);
    this.name = 'SmsError';
    this.code = code;
    this.statusCode = STATUS_MAP[code];
    this.cause = cause;
  }
}
