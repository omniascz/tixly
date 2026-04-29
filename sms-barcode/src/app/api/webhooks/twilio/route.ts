import { NextRequest, NextResponse } from 'next/server';
import { SmsService, verifyTwilioSignature } from '../../../../services/sms.service.js';
import type { DbAdapter, TwilioConfig } from '../../../../types/barcode.types.js';

// ---------------------------------------------------------------------------
// Dependency injection — v produkci nahradit reálnými implementacemi
// ---------------------------------------------------------------------------

declare const db: DbAdapter;

function loadTwilioConfig(): TwilioConfig {
  const accountSid = process.env['TWILIO_ACCOUNT_SID'];
  const authToken = process.env['TWILIO_AUTH_TOKEN'];
  const phoneNumber = process.env['TWILIO_PHONE_NUMBER'];
  const webhookBaseUrl = process.env['BASE_URL'];

  if (!accountSid || !authToken || !phoneNumber || !webhookBaseUrl) {
    throw new Error('Chybí Twilio env proměnné (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER, BASE_URL)');
  }

  return { accountSid, authToken, phoneNumber, webhookBaseUrl };
}

// ---------------------------------------------------------------------------
// TwiML empty response helper
// ---------------------------------------------------------------------------

/**
 * Twilio očekává TwiML XML odpověď. Pro delivery status callbacky postačí prázdný <Response/>.
 */
function twimlEmpty(): NextResponse {
  return new NextResponse('<?xml version="1.0" encoding="UTF-8"?><Response/>', {
    status: 200,
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
    },
  });
}

// ---------------------------------------------------------------------------
// POST handler
// ---------------------------------------------------------------------------

/**
 * POST /api/webhooks/twilio
 *
 * Twilio delivery status callback — aktualizuje stav SMS v tickets.sms_log.
 *
 * Bezpečnost:
 * - Ověření X-Twilio-Signature HMAC-SHA1 (zabrání podvrženým webhookům)
 * - Body je application/x-www-form-urlencoded (Twilio standard)
 *
 * Twilio odesílá:
 *   MessageSid: SM...
 *   MessageStatus: sent | delivered | failed | undelivered | ...
 *   To: +420601234567
 *   From: +1234567890
 *   AccountSid: AC...
 *
 * Response:
 *   200 + prázdné TwiML (Twilio to vyžaduje)
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  // 1. Načteme config (může selhat při chybějících env vars)
  let config: TwilioConfig;
  try {
    config = loadTwilioConfig();
  } catch (err) {
    console.error('[Twilio Webhook] Chybí konfigurace:', err);
    // Vrátíme 200 ať Twilio neprovede retry (nezachytitelný config error)
    return twimlEmpty();
  }

  // 2. Ověření Twilio podpisu
  const twilioSignature = request.headers.get('x-twilio-signature');
  if (!twilioSignature) {
    console.warn('[Twilio Webhook] Chybí X-Twilio-Signature header');
    return new NextResponse('Forbidden', { status: 403 });
  }

  // Sestavíme absolutní URL pro ověření podpisu
  // Twilio podepisuje plnou URL včetně query stringu
  const url = `${config.webhookBaseUrl}/api/webhooks/twilio`;

  // Parsování form-encoded body
  let formData: URLSearchParams;
  try {
    const bodyText = await request.text();
    formData = new URLSearchParams(bodyText);
  } catch {
    console.error('[Twilio Webhook] Nelze parsovat tělo požadavku');
    return twimlEmpty();
  }

  // Převod URLSearchParams na Record<string, string> pro verifikaci
  const params: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    params[key] = value;
  }

  // Ověření HMAC-SHA1 podpisu
  const isValidSignature = verifyTwilioSignature(
    config.authToken,
    twilioSignature,
    url,
    params,
  );

  if (!isValidSignature) {
    console.warn('[Twilio Webhook] Neplatný X-Twilio-Signature — možný podvržený webhook');
    return new NextResponse('Forbidden', { status: 403 });
  }

  // 3. Parsování Twilio parametrů
  const messageSid = formData.get('MessageSid');
  const messageStatus = formData.get('MessageStatus');

  if (!messageSid || !messageStatus) {
    // Twilio může posílat i jiné callbacky (opt-out, atd.) — tiše ignorujeme
    return twimlEmpty();
  }

  // 4. Aktualizace stavu v SMS logu
  try {
    const smsService = new SmsService(config);
    await smsService.handleStatusCallback(messageSid, messageStatus, db);

    console.log(`[Twilio Webhook] Status aktualizován — SID: ${messageSid}, status: ${messageStatus}`);
  } catch (err) {
    // DB chyby logujeme, ale vrátíme 200 ať Twilio neopakuje
    // (retry by způsobil duplicitní záznamy)
    console.error(`[Twilio Webhook] DB chyba při aktualizaci SID ${messageSid}:`, err);
  }

  return twimlEmpty();
}
