/**
 * Google Wallet pass — Add-to-Wallet JWT builder.
 *
 * Production: signed RS256 JWT s Google Service Account private key, vrací URL
 *   `https://pay.google.com/gp/v/save/{jwt}` → tlačítko v UI.
 * Demo: vrací unsigned JWT (RS256 placeholder); v produkci se nahradí keypair.
 */

import { createHmac } from 'crypto';

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
}

const ISSUER_ID = process.env.GOOGLE_WALLET_ISSUER_ID ?? '0000000000000000000';
const CLASS_SUFFIX = process.env.GOOGLE_WALLET_CLASS_SUFFIX ?? 'tixly_event_ticket';
const ORIGIN = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

function base64url(input: string | Buffer): string {
  return Buffer.from(input).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

export function buildGoogleWalletJwt(p: GoogleWalletPassInput): { jwt: string; saveUrl: string } {
  const objectId = `${ISSUER_ID}.${p.ticketId}`;
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
            alternateText: p.ticketId,
          },
        },
      ],
    },
  };

  const header = { alg: 'RS256', typ: 'JWT' };
  const headerB64 = base64url(JSON.stringify(header));
  const payloadB64 = base64url(JSON.stringify(payload));

  // PROD: nahradit RS256 sign(privateKey, `${headerB64}.${payloadB64}`).
  // DEMO: HMAC-SHA256 placeholder s ENCRYPTION_KEY (NEPLATNÉ pro Google Pay, ale validní formát).
  const key = process.env.ENCRYPTION_KEY ?? 'demo-key';
  const sig = createHmac('sha256', key).update(`${headerB64}.${payloadB64}`).digest();
  const sigB64 = base64url(sig);
  const jwt = `${headerB64}.${payloadB64}.${sigB64}`;

  return {
    jwt,
    saveUrl: `https://pay.google.com/gp/v/save/${jwt}`,
  };
}
