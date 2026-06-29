/**
 * Google Wallet pass — Add-to-Wallet JWT builder.
 *
 * Vyrobí JWT, který v `https://pay.google.com/gp/v/save/{jwt}` URL přidá
 * lístek do Google Wallet aplikace v telefonu.
 *
 * Konfigurace v `.env.local` pro produkční fungování:
 *   GOOGLE_WALLET_ISSUER_ID=3388000000022...   (z Google Pay & Wallet Console)
 *   GOOGLE_WALLET_CLASS_SUFFIX=tixly_event_ticket
 *   GOOGLE_WALLET_SERVICE_ACCOUNT=...@...iam.gserviceaccount.com
 *   GOOGLE_WALLET_PRIVATE_KEY_PEM=-----BEGIN PRIVATE KEY-----\n... (přes \n)
 *
 * Bez `GOOGLE_WALLET_PRIVATE_KEY_PEM` se použije HMAC placeholder — JWT je
 * strukturálně validní (lze testovat klientskou stranu), ale Google ho odmítne.
 *
 * Setup:
 *   1. Vytvořit project v Google Cloud Console
 *   2. Enable Google Wallet API
 *   3. Service Account s rolí „Wallet Object Issuer"
 *   4. Download JSON klíč → vytáhnout `private_key` PEM → vložit do env
 *   5. V Wallet Console vytvořit Class (jednorázově):
 *      POST https://walletobjects.googleapis.com/walletobjects/v1/eventTicketClass
 *      Body: { id: "{ISSUER}.tixly_event_ticket", eventName: ..., ... }
 */

import { createSign } from 'crypto';

export interface GoogleWalletPassInput {
  ticketId: string;
  eventTitle: string;
  eventDateIso: string;
  ticketTypeName: string;
  holderName: string | null;
  holderEmail: string;
  venueName: string | null;
  qrPayload: string;
  organizationName: string;
  brandColorHex?: string | null;
  brandLogoUrl?: string | null;
  /** Sedadlo (pro seated vstupenky) */
  seatLabel?: string | null;
  /** Bezbariérový vstup (text z event_zones.accessible_gate) */
  accessibleGateInfo?: string | null;
}

const ISSUER_ID = process.env.GOOGLE_WALLET_ISSUER_ID ?? '3388000000000000000';
const CLASS_SUFFIX = process.env.GOOGLE_WALLET_CLASS_SUFFIX ?? 'tixly_event_ticket';
const ORIGIN = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

function base64url(input: string | Buffer): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=+$/, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

interface SignResult {
  jwt: string;
  saveUrl: string;
  signed: true;
}

export function buildGoogleWalletJwt(p: GoogleWalletPassInput): SignResult {
  const objectId = `${ISSUER_ID}.${p.ticketId.replace(/-/g, '')}`;
  const classId = `${ISSUER_ID}.${CLASS_SUFFIX}`;

  const payload = {
    iss: process.env.GOOGLE_WALLET_SERVICE_ACCOUNT ?? 'tixly-demo@noreply.local',
    aud: 'google',
    typ: 'savetowallet',
    iat: Math.floor(Date.now() / 1000),
    origins: [ORIGIN],
    payload: {
      eventTicketObjects: [
        {
          id: objectId,
          classId,
          state: 'ACTIVE',
          heroImage: p.brandLogoUrl
            ? {
                sourceUri: { uri: p.brandLogoUrl },
                contentDescription: { defaultValue: { language: 'cs', value: p.organizationName } },
              }
            : undefined,
          hexBackgroundColor: p.brandColorHex ?? undefined,
          logo: p.brandLogoUrl
            ? {
                sourceUri: { uri: p.brandLogoUrl },
                contentDescription: { defaultValue: { language: 'cs', value: p.organizationName } },
              }
            : undefined,
          ticketHolderName: p.holderName ?? p.holderEmail,
          ticketNumber: p.ticketId,
          ticketType: { defaultValue: { language: 'cs', value: p.ticketTypeName } },
          venue: p.venueName
            ? { name: { defaultValue: { language: 'cs', value: p.venueName } } }
            : undefined,
          dateTime: { start: p.eventDateIso },
          barcode: {
            type: 'QR_CODE',
            value: p.qrPayload,
            alternateText: p.ticketId.slice(0, 8),
          },
          textModulesData: (() => {
            const m = [
              ...(p.seatLabel ? [{ id: 'seat', header: 'Sedadlo', body: p.seatLabel }] : []),
              ...(p.accessibleGateInfo ? [{ id: 'accessible_gate', header: '♿ Bezbariérový vstup', body: p.accessibleGateInfo }] : []),
            ];
            return m.length > 0 ? m : undefined;
          })(),
        },
      ],
    },
  };

  const header = { alg: 'RS256', typ: 'JWT' };
  const headerB64 = base64url(JSON.stringify(header));
  const payloadB64 = base64url(JSON.stringify(payload));
  const signingInput = `${headerB64}.${payloadB64}`;

  const privateKeyPem = process.env.GOOGLE_WALLET_PRIVATE_KEY_PEM;
  if (!privateKeyPem) {
    throw new Error(
      'GOOGLE_WALLET_PRIVATE_KEY_PEM není nastaven. ' +
      'Vytvoř Service Account v Google Cloud → Google Wallet API → stáhni JSON klíč → ' +
      'vložit private_key PEM do env (\\n jako literál).',
    );
  }

  // Env může mít literály `\n` — překonvertovat na skutečné nové řádky.
  const pem = privateKeyPem.replace(/\\n/g, '\n');
  const signer = createSign('RSA-SHA256');
  signer.update(signingInput);
  signer.end();
  const sigB64 = base64url(signer.sign(pem));

  const jwt = `${headerB64}.${payloadB64}.${sigB64}`;
  return {
    jwt,
    saveUrl: `https://pay.google.com/gp/v/save/${jwt}`,
    signed: true,
  };
}
