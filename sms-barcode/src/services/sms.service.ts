import { createHmac } from 'node:crypto';
import { buildSmsMessage, buildSmsDeliveryMessage } from '../lib/sms-template.js';
import { SmsStatus } from '../types/barcode.types.js';
import type {
  TwilioConfig,
  SmsDelivery,
  DbAdapter,
  SmsSendResult,
} from '../types/barcode.types.js';

// ---------------------------------------------------------------------------
// Twilio HTTP helpers
// ---------------------------------------------------------------------------

interface TwilioMessageResponse {
  sid: string;
  status: string;
  error_code?: string;
  error_message?: string;
}

/**
 * Odešle SMS přes Twilio REST API pomocí fetch (bez Twilio Node.js SDK).
 *
 * Endpoint: POST https://api.twilio.com/2010-04-01/Accounts/{SID}/Messages.json
 * Auth: HTTP Basic (AccountSid:AuthToken)
 * Body: application/x-www-form-urlencoded
 */
async function twilioSendMessage(
  config: TwilioConfig,
  to: string,
  body: string,
  statusCallbackUrl: string,
): Promise<SmsSendResult> {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}/Messages.json`;

  const credentials = Buffer.from(
    `${config.accountSid}:${config.authToken}`,
  ).toString('base64');

  const params = new URLSearchParams({
    From: config.phoneNumber,
    To: to,
    Body: body,
    StatusCallback: statusCallbackUrl,
  });

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });

  const data = (await response.json()) as TwilioMessageResponse;

  if (!response.ok) {
    throw new Error(
      `Twilio API error ${response.status}: ${data.error_message ?? 'Unknown error'} ` +
        `(code: ${data.error_code ?? 'N/A'})`,
    );
  }

  return {
    messageSid: data.sid,
    status: data.status,
  };
}

/**
 * Ověří Twilio webhook podpis (HMAC-SHA1).
 *
 * Twilio podepisuje každý webhook: X-Twilio-Signature = HMAC-SHA1(AuthToken, URL + sorted params)
 *
 * @see https://www.twilio.com/docs/usage/webhooks/webhooks-security
 */
export function verifyTwilioSignature(
  authToken: string,
  signature: string,
  url: string,
  params: Record<string, string>,
): boolean {
  // Seřadíme parametry abecedně a konkatenujeme jako URL+key1value1key2value2...
  const sortedKeys = Object.keys(params).sort();
  const paramString = sortedKeys.map((k) => `${k}${params[k]}`).join('');
  const baseString = url + paramString;

  const expectedSignature = createHmac('sha1', authToken)
    .update(baseString)
    .digest('base64');

  // Konstantní čas porovnání pro ochranu před timing attack
  if (signature.length !== expectedSignature.length) {
    return false;
  }

  let diff = 0;
  for (let i = 0; i < signature.length; i++) {
    diff |= signature.charCodeAt(i) ^ expectedSignature.charCodeAt(i);
  }
  return diff === 0;
}

// ---------------------------------------------------------------------------
// Formátovací helpery pro SMS šablonu
// ---------------------------------------------------------------------------

/**
 * Formátuje datum pro CZ SMS šablonu.
 * Příklad: "15. dubna 2026"
 */
function formatEventDate(date: Date): string {
  return date.toLocaleDateString('cs-CZ', {
    day: 'numeric',
    month: 'long',
    timeZone: 'Europe/Prague',
  });
}

/**
 * Formátuje datum pro post-purchase delivery SMS (včetně roku).
 * Příklad: "15. dubna 2026"
 */
function formatDeliveryDate(date: Date): string {
  return date.toLocaleDateString('cs-CZ', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Europe/Prague',
  });
}

/**
 * Formátuje čas pro CZ SMS šablonu.
 * Příklad: "19:30"
 */
function formatEventTime(date: Date): string {
  return date.toLocaleTimeString('cs-CZ', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Prague',
  });
}

// ---------------------------------------------------------------------------
// SmsService třída
// ---------------------------------------------------------------------------

export class SmsService {
  private readonly config: TwilioConfig;

  constructor(config: TwilioConfig) {
    this.config = config;
  }

  /**
   * Odešle SMS reminder se vstupenkovou informací den před eventem.
   *
   * Flow:
   * 1. Načte vstupenku a event data z DB
   * 2. Sestaví SMS zprávu ze šablony (max 160 znaků)
   * 3. Odešle přes Twilio REST API
   * 4. Zapíše do tickets.sms_log
   *
   * @param ticketId - UUID vstupenky
   * @param phone - Telefonní číslo v E.164 formátu (+420601234567)
   * @param db - Databázový adaptér
   */
  async sendTicketReminder(
    ticketId: string,
    phone: string,
    db: DbAdapter,
  ): Promise<SmsDelivery> {
    // Načteme kompletní data vstupenky
    const ticket = await db.getTicketById(ticketId);
    if (!ticket) {
      throw new Error(`Vstupenka nenalezena: ${ticketId}`);
    }

    if (!ticket.barcodeCode || !ticket.shortCode) {
      throw new Error(
        `Vstupenka ${ticketId} nemá barcode_code nebo short_code. Nejdřív zavolej assignBarcodeCode().`,
      );
    }

    // Sestavení SMS zprávy ze šablony
    const statusCallbackUrl = `${this.config.webhookBaseUrl}/api/webhooks/twilio`;

    const message = buildSmsMessage({
      eventName: ticket.eventName,
      eventDate: formatEventDate(ticket.eventDateStart),
      eventTime: formatEventTime(ticket.eventDateStart),
      venueName: ticket.venueName,
      barcodeCode: ticket.barcodeCode,
      shortCode: ticket.shortCode,
      baseUrl: new URL(this.config.webhookBaseUrl).host,
    });

    const sentAt = new Date();
    let messageSid: string | null = null;
    let status: SmsStatus = SmsStatus.Pending;
    let errorMessage: string | null = null;

    try {
      const result = await twilioSendMessage(
        this.config,
        phone,
        message,
        statusCallbackUrl,
      );
      messageSid = result.messageSid;
      status = SmsStatus.Sent;
    } catch (err) {
      status = SmsStatus.Failed;
      errorMessage = err instanceof Error ? err.message : String(err);
    }

    // Zapíšeme do SMS logu bez ohledu na výsledek
    const smsLogId = await db.insertSmsLog({
      ticketId,
      phone,
      messageSid,
      status,
      sentAt: status === SmsStatus.Sent ? sentAt : null,
      errorMessage,
    });

    return {
      smsLogId,
      ticketId,
      phone,
      messageSid,
      status,
      sentAt: status === SmsStatus.Sent ? sentAt : null,
      errorMessage,
    };
  }

  /**
   * Odešle SMS s odkazem na vstupenku ihned po dokončení objednávky.
   *
   * Rozdíl oproti sendTicketReminder:
   *   - jiná šablona (post-purchase tón "Vstupenka na …")
   *   - idempotence: kontrola, zda už pro ticket existuje 'delivery' SMS log
   *     — pokud existuje záznam se statusem sent/delivered, nic neposílá
   *     a vrací existující SmsDelivery
   *   - loguje se s typem 'delivery' (sendTicketReminder loguje 'reminder')
   *
   * @param ticketId - UUID vstupenky
   * @param phone    - Telefonní číslo v E.164 formátu
   * @param db       - Databázový adaptér
   */
  async sendTicketDelivery(
    ticketId: string,
    phone: string,
    db: DbAdapter,
  ): Promise<SmsDelivery> {
    // 1. Načteme data vstupenky
    const ticket = await db.getTicketById(ticketId);
    if (!ticket) {
      throw new Error(`Vstupenka nenalezena: ${ticketId}`);
    }

    // 2. Ověříme, že má přiřazené barcode/short kódy
    if (!ticket.barcodeCode || !ticket.shortCode) {
      throw new Error(
        `Vstupenka ${ticketId} nemá barcode_code nebo short_code. Nejdřív zavolej assignBarcodeCode().`,
      );
    }

    // 3. Idempotence — pokud už byla delivery SMS úspěšně odeslána, nic neděláme
    const existing = await db.findSmsLogByTicketAndType(ticketId, 'delivery');
    if (
      existing &&
      (existing.status === SmsStatus.Sent || existing.status === SmsStatus.Delivered)
    ) {
      return existing;
    }

    // 4. Sestavíme zprávu
    const message = buildSmsDeliveryMessage({
      eventName: ticket.eventName,
      eventDate: formatDeliveryDate(ticket.eventDateStart),
      shortCode: ticket.shortCode,
      baseUrl: new URL(this.config.webhookBaseUrl).host,
    });

    const statusCallbackUrl = `${this.config.webhookBaseUrl}/api/webhooks/twilio`;

    const sentAt = new Date();
    let messageSid: string | null = null;
    let status: SmsStatus = SmsStatus.Pending;
    let errorMessage: string | null = null;

    // 5. Odeslání přes Twilio
    try {
      const result = await twilioSendMessage(
        this.config,
        phone,
        message,
        statusCallbackUrl,
      );
      messageSid = result.messageSid;
      status = SmsStatus.Sent;
    } catch (err) {
      status = SmsStatus.Failed;
      errorMessage = err instanceof Error ? err.message : String(err);
    }

    // 6. Záznam do SMS logu — vždy, bez ohledu na úspěch
    const smsLogId = await db.insertSmsLog({
      ticketId,
      phone,
      messageSid,
      status,
      sentAt: status === SmsStatus.Sent ? sentAt : null,
      errorMessage,
      type: 'delivery',
    });

    return {
      smsLogId,
      ticketId,
      phone,
      messageSid,
      status,
      sentAt: status === SmsStatus.Sent ? sentAt : null,
      errorMessage,
    };
  }

  /**
   * Zpracuje Twilio delivery status callback (webhook).
   *
   * Twilio volá tento endpoint po změně stavu zprávy:
   * - sent: zpráva přijata mobilním operátorem
   * - delivered: zpráva doručena na telefon
   * - failed: doručení selhalo
   *
   * @param messageSid - Twilio Message SID (SM...)
   * @param twilioStatus - Status z Twilio (sent, delivered, failed, ...)
   * @param db - Databázový adaptér
   */
  async handleStatusCallback(
    messageSid: string,
    twilioStatus: string,
    db: DbAdapter,
  ): Promise<void> {
    const statusMap: Record<string, SmsStatus> = {
      sent: SmsStatus.Sent,
      delivered: SmsStatus.Delivered,
      failed: SmsStatus.Failed,
      undelivered: SmsStatus.Failed,
    };

    const mappedStatus = statusMap[twilioStatus.toLowerCase()];
    if (!mappedStatus) {
      // Ignorujeme neznámé statusy (queued, sending, ...)
      return;
    }

    await db.updateSmsLogStatus(messageSid, mappedStatus);
  }
}
